/*global getBogusProxy */

const DEFAULT_FAVICON = "/img/blank-favicon.svg";

// TODO use export here instead of globals
const Utils = {

  createFavIconElement(url) {
    const imageElement = document.createElement("img");
    imageElement.classList.add("icon", "offpage", "menu-icon");
    imageElement.src = url;
    const loadListener = (e) => {
      e.target.classList.remove("offpage");
      e.target.removeEventListener("load", loadListener);
      e.target.removeEventListener("error", errorListener);
    };
    const errorListener = (e) => {
      e.target.src = DEFAULT_FAVICON;
    };
    imageElement.addEventListener("error", errorListener);
    imageElement.addEventListener("load", loadListener);
    return imageElement;
  },

  // See comment in PR #313 - so far the (hacky) method being used to block proxies is to produce a sufficiently long random address
  getBogusProxy() {
    const bogusFailover = 1;
    const bogusType = "socks4";
    const bogusPort = 9999;
    const bogusUsername = "foo";
    if(typeof window.Utils.pregeneratedString !== "undefined")
    {
      return {type:bogusType, host:`w.${window.Utils.pregeneratedString}.coo`, port:bogusPort, username:bogusUsername, failoverTimeout:bogusFailover};
    }
    else
    {
      // Initialize Utils.pregeneratedString
      window.Utils.pregeneratedString = "";

      // We generate a cryptographically random string (of length specified in bogusLength), but we only do so once - thus negating any time delay caused
      const bogusLength = 8;
      const array = new Uint8Array(bogusLength);
      window.crypto.getRandomValues(array);
      for(let i = 0; i < bogusLength; i++)
      {
        const s = array[i].toString(16);
        if(s.length === 1)
          window.Utils.pregeneratedString += `0${s}`;
        else
          window.Utils.pregeneratedString += s;
      }

      // The only issue with this approach is that if (for some unknown reason) pregeneratedString is not saved, it will result in an infinite loop - but better than a privacy leak!
      return getBogusProxy();
    }
  },

  /**
 * Escapes any occurances of &, ", <, > or / with XML entities.
 *
 * @param {string} str
 *        The string to escape.
 * @return {string} The escaped string.
 */
  escapeXML(str) {
    const replacements = { "&": "&amp;", "\"": "&quot;", "'": "&apos;", "<": "&lt;", ">": "&gt;", "/": "&#x2F;" };
    return String(str).replace(/[&"'<>/]/g, m => replacements[m]);
  },

  /**
 * A tagged template function which escapes any XML metacharacters in
 * interpolated values.
 *
 * @param {Array<string>} strings
 *        An array of literal strings extracted from the templates.
 * @param {Array} values
 *        An array of interpolated values extracted from the template.
 * @returns {string}
 *        The result of the escaped values interpolated with the literal
 *        strings.
 */
  escaped(strings, ...values) {
    const result = [];

    for (const [i, string] of strings.entries()) {
      result.push(string);
      if (i < values.length)
        result.push(this.escapeXML(values[i]));
    }

    return result.join("");
  },

  async currentTab() {
    const activeTabs = await browser.tabs.query({ active: true, windowId: browser.windows.WINDOW_ID_CURRENT });
    if (activeTabs.length > 0) {
      return activeTabs[0];
    }
    return false;
  },

  addEnterHandler(element, handler) {
    element.addEventListener("click", (e) => {
      handler(e);
    });
    element.addEventListener("keydown", (e) => {
      if (e.keyCode === 13) {
        e.preventDefault();
        handler(e);
      }
    });
  },

  addEnterOnlyHandler(element, handler) {
    element.addEventListener("keydown", (e) => {
      if (e.keyCode === 13) {
        e.preventDefault();
        handler(e);
      }
    });
  },

  userContextId(cookieStoreId = "") {
    const userContextId = cookieStoreId.replace("firefox-container-", "");
    return (userContextId !== cookieStoreId) ? Number(userContextId) : false;
  },

  setOrRemoveAssignment(tabId, url, userContextId, value) {
    return browser.runtime.sendMessage({
      method: "setOrRemoveAssignment",
      tabId,
      url,
      userContextId,
      value
    });
  },

  async reloadInContainer(url, currentUserContextId, newUserContextId, tabIndex, active) {
    return await browser.runtime.sendMessage({
      method: "reloadInContainer",
      url,
      currentUserContextId,
      newUserContextId,
      tabIndex,
      active
    });
  },

  async alwaysOpenInContainer(identity) {
    const currentTab = await this.currentTab();
    const assignedUserContextId = this.userContextId(identity.cookieStoreId);
    if (currentTab.cookieStoreId !== identity.cookieStoreId) {
      return await browser.runtime.sendMessage({
        method: "assignAndReloadInContainer",
        url: currentTab.url,
        currentUserContextId: false,
        newUserContextId: assignedUserContextId,
        tabIndex: currentTab.index +1,
        active:currentTab.active
      });
    }
    await Utils.setOrRemoveAssignment(
      currentTab.id,
      currentTab.url,
      assignedUserContextId,
      false
    );
  }
};

window.Utils = Utils;

// The following creates a fake (but convincing) constant Utils.DEFAULT_PROXY
Object.defineProperty(window.Utils, "DEFAULT_PROXY", {
  value: Object.freeze({type: "direct"}),
  writable: false,
  enumerable: true,

  // Setting configurable to false avoids deletion of Utils.DEFAULT_PROXY
  configurable: false
});
