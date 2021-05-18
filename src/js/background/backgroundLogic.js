const DEFAULT_TAB = "about:newtab";
const backgroundLogic = {
  NEW_TAB_PAGES: new Set([
    "about:startpage",
    "about:newtab",
    "about:home",
    "about:blank"
  ]),
  NUMBER_OF_KEYBOARD_SHORTCUTS: 10,
  unhideQueue: [],
  init() {
    browser.commands.onCommand.addListener(function (command) {
      for (let i=0; i < backgroundLogic.NUMBER_OF_KEYBOARD_SHORTCUTS; i++) {
        const key = "open_container_" + i;
        const cookieStoreId = identityState.keyboardShortcut[key];
        if (command === key) {
          if (cookieStoreId === "none") return;
          browser.tabs.create({cookieStoreId});
        }
      }
    });
  },

  async getExtensionInfo() {
    const manifestPath = browser.runtime.getURL("manifest.json");
    const response = await fetch(manifestPath);
    const extensionInfo = await response.json();
    return extensionInfo;
  },

  getUserContextIdFromCookieStoreId(cookieStoreId) {
    if (!cookieStoreId) {
      return false;
    }
    const container = cookieStoreId.replace("firefox-container-", "");
    if (container !== cookieStoreId) {
      return container;
    }
    return false;
  },

  async deleteContainer(userContextId, removed = false) {
    await this._closeTabs(userContextId);
    if (!removed) {
      await browser.contextualIdentities.remove(this.cookieStoreId(userContextId));
    }
    assignManager.deleteContainer(userContextId);
    return {done: true, userContextId};
  },

  async createOrUpdateContainer(options) {
    let donePromise;
    if (options.userContextId !== "new") {
      donePromise = browser.contextualIdentities.update(
        this.cookieStoreId(options.userContextId),
        options.params
      );
    } else {
      donePromise = browser.contextualIdentities.create(options.params);
    }
    await donePromise;
  },

  async openNewTab(options) {
    let url = options.url || undefined;
    const userContextId = ("userContextId" in options) ? options.userContextId : 0;
    const active = ("nofocus" in options) ? options.nofocus : true;
    const discarded = ("noload" in options) ? options.noload : false;

    const cookieStoreId = backgroundLogic.cookieStoreId(userContextId);
    // Autofocus url bar will happen in 54: https://bugzilla.mozilla.org/show_bug.cgi?id=1295072

    // We can't open new tab pages, so open a blank tab. Used in tab un-hide
    if (this.NEW_TAB_PAGES.has(url)) {
      url = undefined;
    }

    if (!this.isPermissibleURL(url)) {
      return;
    }

    return browser.tabs.create({
      url,
      active,
      discarded,
      pinned: options.pinned || false,
      cookieStoreId
    });
  },

  isPermissibleURL(url) {
    const protocol = new URL(url).protocol;
    // We can't open these we just have to throw them away
    if (protocol === "about:"
        || protocol === "chrome:"
        || protocol === "moz-extension:") {
      return false;
    }
    return true;
  },

  checkArgs(requiredArguments, options, methodName) {
    requiredArguments.forEach((argument) => {
      if (!(argument in options)) {
        return new Error(`${methodName} must be called with ${argument} argument.`);
      }
    });
  },

  async getTabs(options) {
    const requiredArguments = ["cookieStoreId", "windowId"];
    this.checkArgs(requiredArguments, options, "getTabs");
    const { cookieStoreId, windowId } = options;

    const list = [];
    const tabs = await browser.tabs.query({
      cookieStoreId,
      windowId
    });
    tabs.forEach((tab) => {
      list.push(identityState._createTabObject(tab));
    });

    const containerState = await identityState.storageArea.get(cookieStoreId);
    return list.concat(containerState.hiddenTabs);
  },

  async unhideContainer(cookieStoreId, alreadyShowingUrl) {
    if (!this.unhideQueue.includes(cookieStoreId)) {
      this.unhideQueue.push(cookieStoreId);
      await this.showTabs({
        cookieStoreId,
        alreadyShowingUrl
      });
      this.unhideQueue.splice(this.unhideQueue.indexOf(cookieStoreId), 1);
    }
  },

  // https://github.com/mozilla/multi-account-containers/issues/847
  async addRemoveSiteIsolation(cookieStoreId, remove = false) {
    const containerState = await identityState.storageArea.get(cookieStoreId);
    try {
      if ("isIsolated" in containerState || remove) {
        delete containerState.isIsolated;
      } else {
        containerState.isIsolated = "locked";        
      }
      return await identityState.storageArea.set(cookieStoreId, containerState);
    } catch (error) {
      console.error(`No container: ${cookieStoreId}`);
    }
  },

  async moveTabsToWindow(options) {
    const requiredArguments = ["cookieStoreId", "windowId"];
    this.checkArgs(requiredArguments, options, "moveTabsToWindow");
    const { cookieStoreId, windowId } = options;

    const list = await browser.tabs.query({
      cookieStoreId,
      windowId
    });

    const containerState = await identityState.storageArea.get(cookieStoreId);

    // Nothing to do
    if (list.length === 0 &&
        containerState.hiddenTabs.length === 0) {
      return;
    }
    let newWindowObj;
    let hiddenDefaultTabToClose;
    if (list.length) {
      newWindowObj = await browser.windows.create();

      // Pin the default tab in the new window so existing pinned tabs can be moved after it.
      // From the docs (https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/tabs/move):
      //   Note that you can't move pinned tabs to a position after any unpinned tabs in a window, or move any unpinned tabs to a position before any pinned tabs.
      await browser.tabs.update(newWindowObj.tabs[0].id, { pinned: true });

      browser.tabs.move(list.map((tab) => tab.id), {
        windowId: newWindowObj.id,
        index: -1
      });
    } else {
      //As we get a blank tab here we will need to await the tabs creation
      newWindowObj = await browser.windows.create({
      });
      hiddenDefaultTabToClose = true;
    }

    const showHiddenPromises = [];

    // Let's show the hidden tabs.
    if (!this.unhideQueue.includes(cookieStoreId)) {
      this.unhideQueue.push(cookieStoreId);
      for (let object of containerState.hiddenTabs) { // eslint-disable-line prefer-const
        showHiddenPromises.push(browser.tabs.create({
          url: object.url || DEFAULT_TAB,
          windowId: newWindowObj.id,
          cookieStoreId
        }));
      }
    }

    if (hiddenDefaultTabToClose) {
      // Lets wait for hidden tabs to show before closing the others
      await showHiddenPromises;
    }

    containerState.hiddenTabs = [];

    // Let's close all the normal tab in the new window. In theory it
    // should be only the first tab, but maybe there are addons doing
    // crazy stuff.
    const tabs = await browser.tabs.query({windowId: newWindowObj.id});
    for (let tab of tabs) { // eslint-disable-line prefer-const
      if (tab.cookieStoreId !== cookieStoreId) {
        browser.tabs.remove(tab.id);
      }
    }
    const rv = await identityState.storageArea.set(cookieStoreId, containerState);
    this.unhideQueue.splice(this.unhideQueue.indexOf(cookieStoreId), 1);
    return rv;
  },

  async _closeTabs(userContextId, windowId = false) {
    const cookieStoreId = this.cookieStoreId(userContextId);
    let tabs;
    /* if we have no windowId we are going to close all this container (used for deleting) */
    if (windowId !== false) {
      tabs = await browser.tabs.query({
        cookieStoreId,
        windowId
      });
    } else {
      tabs = await browser.tabs.query({
        cookieStoreId
      });
    }
    const tabIds = tabs.map((tab) => tab.id);
    return browser.tabs.remove(tabIds);
  },

  async queryIdentitiesState(windowId) {
    const identities = await browser.contextualIdentities.query({});
    const identitiesOutput = {};
    const identitiesPromise = identities.map(async (identity) => {
      const { cookieStoreId } = identity;
      const containerState = await identityState.storageArea.get(cookieStoreId);
      const openTabs = await browser.tabs.query({
        cookieStoreId,
        windowId
      });
      identitiesOutput[cookieStoreId] = {
        hasHiddenTabs: !!containerState.hiddenTabs.length,
        hasOpenTabs: !!openTabs.length,
        numberOfHiddenTabs: containerState.hiddenTabs.length,
        numberOfOpenTabs: openTabs.length,
        isIsolated: !!containerState.isIsolated
      };
      return;
    });
    await Promise.all(identitiesPromise);
    return identitiesOutput;
  },

  async sortTabs() {
    const windows = await browser.windows.getAll();
    for (let windowObj of windows) { // eslint-disable-line prefer-const
      // First the pinned tabs, then the normal ones.
      await this._sortTabsInternal(windowObj, true);
      await this._sortTabsInternal(windowObj, false);
    }
  },

  async _sortTabsInternal(windowObj, pinnedTabs) {
    const tabs = await browser.tabs.query({windowId: windowObj.id});
    let pos = 0;

    // Let's collect UCIs/tabs for this window.
    const map = new Map;
    for (const tab of tabs) {
      if (pinnedTabs && !tab.pinned) {
        // We don't have, or we already handled all the pinned tabs.
        break;
      }

      if (!pinnedTabs && tab.pinned) {
        // pinned tabs must be consider as taken positions.
        ++pos;
        continue;
      }

      const userContextId = backgroundLogic.getUserContextIdFromCookieStoreId(tab.cookieStoreId);
      if (!map.has(userContextId)) {
        map.set(userContextId, []);
      }
      map.get(userContextId).push(tab);
    }

    // Let's sort the map.
    const sortMap = new Map([...map.entries()].sort((a, b) => a[0] > b[0]));

    // Let's move tabs.
    sortMap.forEach(tabs => {
      for (const tab of tabs) {
        ++pos;
        browser.tabs.move(tab.id, {
          windowId: windowObj.id,
          index: pos
        });
      }
    });
  },

  async hideTabs(options) {
    const requiredArguments = ["cookieStoreId", "windowId"];
    this.checkArgs(requiredArguments, options, "hideTabs");
    const { cookieStoreId, windowId } = options;

    const userContextId = backgroundLogic.getUserContextIdFromCookieStoreId(cookieStoreId);

    const containerState = await identityState.storeHidden(cookieStoreId, windowId);
    await this._closeTabs(userContextId, windowId);
    return containerState;
  },

  async showTabs(options) {
    if (!("cookieStoreId" in options)) {
      return Promise.reject("showTabs must be called with cookieStoreId argument.");
    }

    const userContextId = backgroundLogic.getUserContextIdFromCookieStoreId(options.cookieStoreId);
    const promises = [];

    const containerState = await identityState.storageArea.get(options.cookieStoreId);

    for (let object of containerState.hiddenTabs) { // eslint-disable-line prefer-const
      // do not show already opened url
      const noload = !object.pinned;
      if (object.url !== options.alreadyShowingUrl) {
        promises.push(this.openNewTab({
          userContextId: userContextId,
          url: object.url,
          nofocus: options.nofocus || false,
          noload: noload,
          pinned: object.pinned,
        }));
      }
    }

    containerState.hiddenTabs = [];

    await Promise.all(promises);
    return identityState.storageArea.set(options.cookieStoreId, containerState);
  },

  cookieStoreId(userContextId) {
    if(userContextId === 0) return "firefox-default";
    return `firefox-container-${userContextId}`;
  }
};


backgroundLogic.init();