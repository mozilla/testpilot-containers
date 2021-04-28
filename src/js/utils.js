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
  },

  /**
   * Get the allowed site key for a given url, hostname, or hostname:port
   * @param {string} pageUrl
   * @returns the allowed site key for the given url
   */
  getAllowedSiteKeyFor(pageUrl) {
    if (!pageUrl) {
      throw new Error("pageUrl cannot be empty");
    }

    if (pageUrl.startsWith("allowedSiteKey@@_")) {
      // we trust that you're a key already
      return pageUrl;
    }

    // attempt to parse the attribute as a naked hostname
    if (this._isValidHostname(pageUrl)) {
      return this._allowedSiteKeyForHostPort(pageUrl);
    }

    // attempt to parse the attribute as a hostname:port
    if (pageUrl.includes(":")) {
      const parts = pageUrl.split(":");
      if (parts.length === 2) {
        const potentialHost = parts[0];
        const potentialPort = parts[1];
        if (this._isValidHostname(potentialHost) && this._isValidPort(potentialPort)) {
          return this._allowedSiteKeyForHostPort(potentialHost, potentialPort);
        }
      }
    }

    // try parsing the attribute as a page url
    try {
      const url = new window.URL(pageUrl);
      return this._allowedSiteKeyForHostPort(url.hostname, url.port);
    } catch (err) {
      console.log(`paramter ${pageUrl} was not parsed as a url`);
    }

    throw new Error("pageUrl could not be parsed");
  },

  getLabelForAllowedSiteKey(allowedSiteKey) {
    if (!allowedSiteKey) {
      throw new Error("pageUrl cannot be empty");
    }

    if (allowedSiteKey.startsWith("allowedSiteKey@@_")) {
      return allowedSiteKey.replace("allowedSiteKey@@_", "");
    }

    return allowedSiteKey;
  },

  _isValidPort(potentialPort) {
    return potentialPort > 0 && potentialPort <= 65535;
  },

  _isValidHostname(potentialHostname) {
    // From @bkr https://stackoverflow.com/a/20204811
    return /(?=^.{4,253}$)(^((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9]\.)+[a-zA-Z]{2,63}$)/.test(
      potentialHostname
    );
  },

  _allowedSiteKeyForHostPort(hostname, port) {
    if (port === undefined || port === "" || port === "80" || port === "443") {
      return `allowedSiteKey@@_${hostname}`;
    } else {
      return `allowedSiteKey@@_${hostname}:${port}`;
    }
  },

};


window.Utils = Utils;