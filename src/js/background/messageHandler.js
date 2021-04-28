const messageHandler = {
  // After the timer completes we assume it's a tab the user meant to keep open
  // We use this to catch redirected tabs that have just opened
  // If this were in platform we would change how the tab opens based on "new tab" link navigations such as ctrl+click
  LAST_CREATED_TAB_TIMER: 2000,

  init() {
    // Handles messages from webextension code
    browser.runtime.onMessage.addListener(async (m) => {
      let response;
      let tab;

      switch (m.method) {
      case "getShortcuts":
        response = identityState.storageArea.loadKeyboardShortcuts();
        break;
      case "setShortcut":
        identityState.storageArea.setKeyboardShortcut(m.shortcut, m.cookieStoreId);
        break;
      case "resetSync":
        response = sync.resetSync();
        break;
      case "resetBookmarksContext":
        response = assignManager.resetBookmarksMenuItem();
        break;
      case "deleteContainer":
        response = backgroundLogic.deleteContainer(m.message.userContextId);
        break;
      case "createOrUpdateContainer":
        response = backgroundLogic.createOrUpdateContainer(m.message);
        break;
      case "neverAsk":
        assignManager._neverAsk(m);
        break;
      case "addRemoveSiteIsolation":
        response = backgroundLogic.addRemoveSiteIsolation(m.cookieStoreId);
        break;
      case "addRemoveAllowedSite":
        response = backgroundLogic.addRemoveAllowedSite(
          m.cookieStoreId,
          m.allowedSiteUrl,
          m.remove
        );
        break;
      case "clearAllowedSites":
        response = backgroundLogic.clearAllowedSites(m.cookieStoreId);
        break;
      case "getAssignment":
        response = browser.tabs.get(m.tabId).then((tab) => {
          return assignManager._getAssignment(tab);
        });
        break;
      case "getAssignmentObjectByContainer":
        response = assignManager._getByContainer(m.message.userContextId);
        break;
      case "setOrRemoveAssignment":
        // m.tabId is used for where to place the in content message
        // m.url is the assignment to be removed/added
        response = assignManager._setOrRemoveAssignment(m.tabId, m.url, m.userContextId, m.value);
        break;
      case "sortTabs":
        backgroundLogic.sortTabs();
        break;
      case "showTabs":
        backgroundLogic.unhideContainer(m.cookieStoreId);
        break;
      case "hideTabs":
        backgroundLogic.hideTabs({
          cookieStoreId: m.cookieStoreId,
          windowId: m.windowId
        });
        break;
      case "checkIncompatibleAddons":
        // TODO
        break;
      case "moveTabsToWindow":
        response = backgroundLogic.moveTabsToWindow({
          cookieStoreId: m.cookieStoreId,
          windowId: m.windowId
        });
        break;
      case "getTabs":
        response = backgroundLogic.getTabs({
          cookieStoreId: m.cookieStoreId,
          windowId: m.windowId
        });
        break;
      case "queryIdentitiesState":
        response = backgroundLogic.queryIdentitiesState(m.message.windowId);
        break;
      case "exemptContainerAssignment":
        response = assignManager._exemptTab(m);
        break;
      case "reloadInContainer":
        response = assignManager.reloadPageInContainer(
          m.url, 
          m.currentUserContextId, 
          m.newUserContextId, 
          m.tabIndex, 
          m.active,
          true
        );
        break;
      case "assignAndReloadInContainer":
        tab = await assignManager.reloadPageInContainer(
          m.url, 
          m.currentUserContextId, 
          m.newUserContextId, 
          m.tabIndex, 
          m.active,
          true
        );
        // m.tabId is used for where to place the in content message
        // m.url is the assignment to be removed/added
        response = browser.tabs.get(tab.id).then((tab) => {
          return assignManager._setOrRemoveAssignment(tab.id, m.url, m.newUserContextId, m.value);
        });
        break;
      }
      return response;
    });

    // Handles external messages from webextensions
    const externalExtensionAllowed = {};
    browser.runtime.onMessageExternal.addListener(async (message, sender) => {
      if (!externalExtensionAllowed[sender.id]) {
        const extensionInfo = await browser.management.get(sender.id);
        if (!extensionInfo.permissions.includes("contextualIdentities")) {
          throw new Error("Missing contextualIdentities permission");
        }
        // eslint-disable-next-line require-atomic-updates
        externalExtensionAllowed[sender.id] = true;
      }
      let response;
      switch (message.method) {
      case "getAssignment":
        if (typeof message.url === "undefined") {
          throw new Error("Missing message.url");
        }
        response = assignManager.storageArea.get(message.url);
        break;
      default:
        throw new Error("Unknown message.method");
      }
      return response;
    });
    // Delete externalExtensionAllowed if add-on installs/updates; permissions might change
    browser.management.onInstalled.addListener(extensionInfo => {
      if (externalExtensionAllowed[extensionInfo.id]) {
        delete externalExtensionAllowed[extensionInfo.id];
      }
    });
    // Delete externalExtensionAllowed if add-on uninstalls; not needed anymore
    browser.management.onUninstalled.addListener(extensionInfo => {
      if (externalExtensionAllowed[extensionInfo.id]) {
        delete externalExtensionAllowed[extensionInfo.id];
      }
    });

    if (browser.contextualIdentities.onRemoved) {
      browser.contextualIdentities.onRemoved.addListener(({contextualIdentity}) => {
        const userContextId = backgroundLogic.getUserContextIdFromCookieStoreId(contextualIdentity.cookieStoreId);
        backgroundLogic.deleteContainer(userContextId, true);
      });
    }

    browser.tabs.onActivated.addListener((info) => {
      assignManager.removeContextMenu();
      browser.tabs.get(info.tabId).then((tab) => {
        assignManager.calculateContextMenu(tab);
      }).catch((e) => {
        throw e;
      });
    });

    browser.windows.onFocusChanged.addListener((windowId) => {
      this.onFocusChangedCallback(windowId);
    });

    browser.webRequest.onCompleted.addListener((details) => {
      if (details.frameId !== 0 || details.tabId === -1) {
        return {};
      }
      assignManager.removeContextMenu();

      browser.tabs.get(details.tabId).then((tab) => {
        assignManager.calculateContextMenu(tab);
      }).catch((e) => {
        throw e;
      });
    }, {urls: ["<all_urls>"], types: ["main_frame"]});

    browser.tabs.onCreated.addListener((tab) => {
      // lets remember the last tab created so we can close it if it looks like a redirect
      this.lastCreatedTab = tab;
      if (tab.cookieStoreId) {
        // Don't count firefox-default, firefox-private, nor our own confirm page loads
        if (tab.cookieStoreId !== "firefox-default" &&
            tab.cookieStoreId !== "firefox-private" &&
            !tab.url.startsWith("moz-extension")) {
          // increment the counter of container tabs opened
          this.incrementCountOfContainerTabsOpened();

          this.tabUpdateHandler = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === "complete") {
              // get current tab's url to not open the same one from hidden tabs
              browser.tabs.get(tabId).then(loadedTab => {
                backgroundLogic.unhideContainer(tab.cookieStoreId, loadedTab.url);
              }).catch((e) => {
                throw e;
              });

              browser.tabs.onUpdated.removeListener(this.tabUpdateHandler);
            }
          };

          // if it's a container tab wait for it to complete and
          // unhide other tabs from this container
          if (tab.cookieStoreId.startsWith("firefox-container")) {
            browser.tabs.onUpdated.addListener(this.tabUpdateHandler);
          }
        }
      }
      setTimeout(() => {
        this.lastCreatedTab = null;
      }, this.LAST_CREATED_TAB_TIMER);
    });
  },

  async incrementCountOfContainerTabsOpened() {
    const key = "containerTabsOpened";
    const count = await browser.storage.local.get({[key]: 0});
    const countOfContainerTabsOpened = ++count[key];
    browser.storage.local.set({[key]: countOfContainerTabsOpened});

    // When the user opens their _ tab, give them the achievement
    if (countOfContainerTabsOpened === 100) {
      const storage = await browser.storage.local.get({achievements: []});
      storage.achievements.push({"name": "manyContainersOpened", "done": false});
      // use set and spread to create a unique array
      const achievements = [...new Set(storage.achievements)];
      browser.storage.local.set({achievements});
      browser.browserAction.setBadgeBackgroundColor({color: "rgba(0,217,0,255)"});
      browser.browserAction.setBadgeText({text: "NEW"});
    }
  },

  async onFocusChangedCallback(windowId) {
    assignManager.removeContextMenu();
    // browserAction loses background color in new windows ...
    // https://bugzil.la/1314674
    // https://github.com/mozilla/testpilot-containers/issues/608
    // ... so re-call displayBrowserActionBadge on window changes
    badge.displayBrowserActionBadge();
    browser.tabs.query({active: true, windowId}).then((tabs) => {
      if (tabs && tabs[0]) {
        assignManager.calculateContextMenu(tabs[0]);
      }
    }).catch((e) => {
      throw e;
    });
  }
};

// Lets do this last as theme manager did a check before connecting before
messageHandler.init();
