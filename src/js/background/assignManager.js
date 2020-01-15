const assignManager = {
  MENU_ASSIGN_ID: "open-in-this-container",
  MENU_REMOVE_ID: "remove-open-in-this-container",
  MENU_SEPARATOR_ID: "separator",
  MENU_HIDE_ID: "hide-container",
  MENU_MOVE_ID: "move-to-new-window-container",
  OPEN_IN_CONTAINER: "open-bookmark-in-container-tab",
  storageArea: {
    area: new utils.NamedStore("siteContainerMap"),
    exemptedTabs: {},

    async matchUrl(pageUrl) {
      const siteId = backgroundLogic.getSiteIdFromUrl(pageUrl);
      
      // Try exact match
      let siteSettings = await this.get(siteId);
      
      if (!siteSettings) {
        // Try wildcard match
        const wildcard = await wildcardManager.match(siteId);
        if (wildcard) {
          siteSettings = await this.get(wildcard);
        }
      }
      
      return siteSettings;
    },
    
    create(siteId, userContextId, options = {}) {
      const siteSettings = { userContextId, neverAsk:!!options.neverAsk };
      this._setTransientProperties(siteId, siteSettings, options.wildcard);
      return siteSettings;
    },

    async get(siteId) {
      const siteSettings = await this.area.get(siteId);
      await this._loadTransientProperties(siteId, siteSettings);
      return siteSettings;
    },

    async set(siteSettings) {
      const siteId = siteSettings.siteId;
      const exemptedTabs = siteSettings.exemptedTabs;
      const wildcard = siteSettings.wildcard;
      
      // Store exempted tabs
      this.exemptedTabs[siteId] = exemptedTabs;
      
      // Store/remove wildcard mapping
      if (wildcard && wildcard !== siteId) {
        await wildcardManager.set(siteId, wildcard);
      } else {
        await wildcardManager.remove(siteId);
      }
      
      // Remove transient properties before storing
      const cleanSiteSettings = Object.assign({}, siteSettings);
      this._unsetTransientProperties(cleanSiteSettings);
      
      // Store assignment
      return this.area.set(siteId, cleanSiteSettings);
    },

    async remove(siteId) {
      // When we remove an assignment we should clear all the exemptions
      delete this.exemptedTabs[siteId];
      // ...and also clear the wildcard mapping
      await wildcardManager.remove(siteId);
      
      return this.area.remove(siteId);
    },

    async deleteContainer(userContextId) {
      const siteSettingsById = await this.getByContainer(userContextId);
      const siteIds = Object.keys(siteSettingsById);
      
      siteIds.forEach((siteId) => {
        // When we remove an assignment we should clear all the exemptions
        delete this.exemptedTabs[siteId];
      });
      
      // ...and also clear the wildcard mappings
      await wildcardManager.removeAll(siteIds);

      return this.area.removeAll(siteIds);
    },

    async getByContainer(userContextId) {
      const siteSettingsById = await this.area.getSome((siteId, siteSettings) => {
        // For some reason this is stored as string... lets check them both as that
        return String(siteSettings.userContextId) === String(userContextId);
      });
      await this._loadTransientPropertiesForAll(siteSettingsById);      
      return siteSettingsById;
    },
    
    async _loadTransientProperties(siteId, siteSettings) {
      if (siteId && siteSettings) {
        const wildcard = await wildcardManager.get(siteId);
        const exemptedTabs = this.exemptedTabs[siteId];
        this._setTransientProperties(siteId, siteSettings, wildcard, exemptedTabs);
      }
    },
    
    async _loadTransientPropertiesForAll(siteSettingsById) {
      const siteIds = Object.keys(siteSettingsById);
      if (siteIds.length > 0) {
        const siteIdsToWildcards = await wildcardManager.getAll(siteIds);        
        siteIds.forEach((siteId) => {
          const siteSettings = siteSettingsById[siteId];
          const wildcard = siteIdsToWildcards[siteId];
          const exemptedTabs = this.exemptedTabs[siteId];
          this._setTransientProperties(siteId, siteSettings, wildcard, exemptedTabs);
        });
      }
    },
    
    _setTransientProperties(siteId, siteSettings, wildcard, exemptedTabs = []) {
      siteSettings.siteId = siteId;
      siteSettings.hostname = siteId;
      siteSettings.wildcard = wildcard;
      siteSettings.exemptedTabs = exemptedTabs;
    },
    
    _unsetTransientProperties(siteSettings) {
      delete siteSettings.siteId;
      delete siteSettings.hostname;
      delete siteSettings.wildcard;
      delete siteSettings.exemptedTabs;
    }
  },

  async _neverAsk(m) {
    const pageUrl = m.pageUrl;
    const neverAsk = m.neverAsk;
    if (neverAsk === true) {
      const siteSettings = await this.storageArea.matchUrl(pageUrl);
      if (siteSettings && !siteSettings.neverAsk) {
        siteSettings.neverAsk = true;
        await this.storageArea.set(siteSettings);
      }
    }
  },

  async _exemptTab(m) {
    const pageUrl = m.pageUrl;
    const tabId = m.tabId;
    const siteSettings = await this.storageArea.matchUrl(pageUrl);
    if (siteSettings && siteSettings.exemptedTabs.indexOf(tabId) === -1) {
      siteSettings.exemptedTabs.push(tabId);
      await this.storageArea.set(siteSettings);
    }
  },

  // Before a request is handled by the browser we decide if we should route through a different container
  async onBeforeRequest(options) {
    if (options.frameId !== 0 || options.tabId === -1) {
      return {};
    }
    this.removeContextMenu();
    const [tab, siteSettings] = await Promise.all([
      browser.tabs.get(options.tabId),
      this.storageArea.matchUrl(options.url)
    ]);
    let container;
    try {
      container = await browser.contextualIdentities.get(backgroundLogic.cookieStoreId(siteSettings.userContextId));
    } catch (e) {
      container = false;
    }

    // The container we have in the assignment map isn't present any more so lets remove it
    //   then continue the existing load
    if (siteSettings && !container) {
      this.deleteContainer(siteSettings.userContextId);
      return {};
    }
    const userContextId = this.getUserContextIdFromCookieStore(tab);
    if (!siteSettings
        || siteSettings.userContextId === userContextId
        || siteSettings.exemptedTabs.includes(tab.id)) {
      return {};
    }
    const removeTab = backgroundLogic.NEW_TAB_PAGES.has(tab.url)
      || (messageHandler.lastCreatedTab
        && messageHandler.lastCreatedTab.id === tab.id);
    const openTabId = removeTab ? tab.openerTabId : tab.id;

    if (!this.canceledRequests[tab.id]) {
      // we decided to cancel the request at this point, register canceled request
      this.canceledRequests[tab.id] = {
        requestIds: {
          [options.requestId]: true
        },
        urls: {
          [options.url]: true
        }
      };

      // since webRequest onCompleted and onErrorOccurred are not 100% reliable (see #1120)
      // we register a timer here to cleanup canceled requests, just to make sure we don't
      // end up in a situation where certain urls in a tab.id stay canceled
      setTimeout(() => {
        if (this.canceledRequests[tab.id]) {
          delete this.canceledRequests[tab.id];
        }
      }, 2000);
    } else {
      let cancelEarly = false;
      if (this.canceledRequests[tab.id].requestIds[options.requestId] ||
          this.canceledRequests[tab.id].urls[options.url]) {
        // same requestId or url from the same tab
        // this is a redirect that we have to cancel early to prevent opening two tabs
        cancelEarly = true;
      }
      // we decided to cancel the request at this point, register canceled request
      this.canceledRequests[tab.id].requestIds[options.requestId] = true;
      this.canceledRequests[tab.id].urls[options.url] = true;
      if (cancelEarly) {
        return {
          cancel: true
        };
      }
    }

    this.reloadPageInContainer(
      options.url,
      userContextId,
      siteSettings.userContextId,
      tab.index + 1,
      tab.active,
      siteSettings.neverAsk,
      openTabId
    );
    this.calculateContextMenu(tab);

    /* Removal of existing tabs:
        We aim to open the new assigned container tab / warning prompt in it's own tab:
          - As the history won't span from one container to another it seems most sane to not try and reopen a tab on history.back()
          - When users open a new tab themselves we want to make sure we don't end up with three tabs as per: https://github.com/mozilla/testpilot-containers/issues/421
        If we are coming from an internal url that are used for the new tab page (NEW_TAB_PAGES), we can safely close as user is unlikely losing history
        Detecting redirects on "new tab" opening actions is pretty hard as we don't get tab history:
        - Redirects happen from Short URLs and tracking links that act as a gateway
        - Extensions don't provide a way to history crawl for tabs, we could inject content scripts to do this
            however they don't run on about:blank so this would likely be just as hacky.
        We capture the time the tab was created and close if it was within the timeout to try to capture pages which haven't had user interaction or history.
    */
    if (removeTab) {
      browser.tabs.remove(tab.id);
    }
    return {
      cancel: true,
    };
  },

  init() {
    browser.contextMenus.onClicked.addListener((info, tab) => {
      info.bookmarkId ? this._onClickedBookmark(info) : this._onClickedHandler(info, tab);
    });

    // Before a request is handled by the browser we decide if we should route through a different container
    this.canceledRequests = {};
    browser.webRequest.onBeforeRequest.addListener((options) => {
      return this.onBeforeRequest(options);
    },{urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

    // Clean up canceled requests
    browser.webRequest.onCompleted.addListener((options) => {
      if (this.canceledRequests[options.tabId]) {
        delete this.canceledRequests[options.tabId];
      }
    },{urls: ["<all_urls>"], types: ["main_frame"]});
    browser.webRequest.onErrorOccurred.addListener((options) => {
      if (this.canceledRequests[options.tabId]) {
        delete this.canceledRequests[options.tabId];
      }
    },{urls: ["<all_urls>"], types: ["main_frame"]});
    this.resetBookmarksMenuItem();
  },

  async resetBookmarksMenuItem() {
    const hasPermission = await browser.permissions.contains({permissions: ["bookmarks"]});
    if (this.hadBookmark === hasPermission) {
      return;
    }
    this.hadBookmark = hasPermission;
    if (hasPermission) {
      this.initBookmarksMenu();
      browser.contextualIdentities.onCreated.addListener(this.contextualIdentityCreated);
      browser.contextualIdentities.onUpdated.addListener(this.contextualIdentityUpdated);
      browser.contextualIdentities.onRemoved.addListener(this.contextualIdentityRemoved);
    } else {
      this.removeBookmarksMenu();
      browser.contextualIdentities.onCreated.removeListener(this.contextualIdentityCreated);
      browser.contextualIdentities.onUpdated.removeListener(this.contextualIdentityUpdated);
      browser.contextualIdentities.onRemoved.removeListener(this.contextualIdentityRemoved);
    }
  },

  contextualIdentityCreated(changeInfo) {
    browser.contextMenus.create({
      parentId: assignManager.OPEN_IN_CONTAINER,
      id: changeInfo.contextualIdentity.cookieStoreId,
      title: changeInfo.contextualIdentity.name,
      icons: { "16": `img/usercontext.svg#${changeInfo.contextualIdentity.icon}` }
    });
  },

  contextualIdentityUpdated(changeInfo) {
    browser.contextMenus.update(changeInfo.contextualIdentity.cookieStoreId, {
      title: changeInfo.contextualIdentity.name,
      icons: { "16": `img/usercontext.svg#${changeInfo.contextualIdentity.icon}` }
    });
  },

  contextualIdentityRemoved(changeInfo) {
    browser.contextMenus.remove(changeInfo.contextualIdentity.cookieStoreId);
  },

  async _onClickedHandler(info, tab) {
    const userContextId = this.getUserContextIdFromCookieStore(tab);
    // Mapping ${URL(info.pageUrl).hostname} to ${userContextId}
    let remove;
    if (userContextId) {
      switch (info.menuItemId) {
      case this.MENU_ASSIGN_ID:
      case this.MENU_REMOVE_ID:
        if (info.menuItemId === this.MENU_ASSIGN_ID) {
          remove = false;
        } else {
          remove = true;
        }
        await this._setOrRemoveAssignment(tab.id, info.pageUrl, userContextId, remove);
        break;
      case this.MENU_MOVE_ID:
        backgroundLogic.moveTabsToWindow({
          cookieStoreId: tab.cookieStoreId,
          windowId: tab.windowId,
        });
        break;
      case this.MENU_HIDE_ID:
        backgroundLogic.hideTabs({
          cookieStoreId: tab.cookieStoreId,
          windowId: tab.windowId,
        });
        break;
      }
    }
  },

  async _onClickedBookmark(info) {

    async function _getBookmarksFromInfo(info) {
      const [bookmarkTreeNode] = await browser.bookmarks.get(info.bookmarkId);
      if (bookmarkTreeNode.type === "folder") {
        return await browser.bookmarks.getChildren(bookmarkTreeNode.id);
      }
      return [bookmarkTreeNode];
    }

    const bookmarks = await _getBookmarksFromInfo(info);
    for (const bookmark of bookmarks) {
      // Some checks on the urls from https://github.com/Rob--W/bookmark-container-tab/ thanks!
      if ( !/^(javascript|place):/i.test(bookmark.url) && bookmark.type !== "folder") {
        const openInReaderMode = bookmark.url.startsWith("about:reader");
        if(openInReaderMode) {
          try {
            const parsed = new URL(bookmark.url);
            bookmark.url = parsed.searchParams.get("url") + parsed.hash;
          } catch (err) {
            return err.message;
          }
        }
        browser.tabs.create({
          cookieStoreId: info.menuItemId,
          url: bookmark.url,
          openInReaderMode: openInReaderMode
        });
      }
    }
  },


  deleteContainer(userContextId) {
    this.storageArea.deleteContainer(userContextId);
  },

  getUserContextIdFromCookieStore(tab) {
    if (!("cookieStoreId" in tab)) {
      return false;
    }
    return backgroundLogic.getUserContextIdFromCookieStoreId(tab.cookieStoreId);
  },

  isTabPermittedAssign(tab) {
    // Ensure we are not an important about url
    const url = new URL(tab.url);
    if (url.protocol === "about:"
        || url.protocol === "moz-extension:") {
      return false;
    }
    return true;
  },

  _determineAssignmentMatchesUrl(siteSettings, url) {
    const siteId = backgroundLogic.getSiteIdFromUrl(url);
    if (siteSettings.siteId === siteId) { return true; }
    if (siteSettings.wildcard && siteId.endsWith(siteSettings.wildcard)) { return true; }
    return false;
  },

  async _setOrRemoveAssignment(tabId, pageUrl, userContextId, remove, options = {}) {
    let actionName;

    // https://github.com/mozilla/testpilot-containers/issues/626
    // Context menu has stored context IDs as strings, so we need to coerce
    // the value to a string for accurate checking
    userContextId = String(userContextId);

    const siteId = backgroundLogic.getSiteIdFromUrl(pageUrl);
    if (!remove) {
      const siteSettings = this.storageArea.create(siteId, userContextId, options);
      
      // Auto exempt all tabs that exist for this hostname that are not in the same container
      const tabs = await browser.tabs.query({});
      siteSettings.exemptedTabs = tabs.filter((tab) => {
        if (!this._determineAssignmentMatchesUrl(siteSettings, tab.url)) { return false; }
        if (this.getUserContextIdFromCookieStore(tab) === userContextId) { return false; }
        return true;
      }).map((tab) => {
        return tab.id;
      });
      
      await this.storageArea.set(siteSettings);
      actionName = "added";
    } else {
      await this.storageArea.remove(siteId);
      actionName = "removed";
    }
    if (!options.silent) {
      browser.tabs.sendMessage(tabId, {
        text: `Successfully ${actionName} site to always open in this container`
      });
    }
    const tab = await browser.tabs.get(tabId);
    this.calculateContextMenu(tab);
  },
  
  async _setOrRemoveWildcard(tabId, pageUrl, userContextId, wildcard) {
    // Get existing settings, so we can preserve neverAsk property
    const siteId = backgroundLogic.getSiteIdFromUrl(pageUrl);
    const siteSettings = await this.storageArea.get(siteId);
    const neverAsk = siteSettings && siteSettings.neverAsk;
    
    // Remove assignment
    await this._setOrRemoveAssignment(tabId, pageUrl, userContextId, true, {silent:true});
    // Add assignment
    await this._setOrRemoveAssignment(tabId, pageUrl, userContextId, false, {silent:true, wildcard:wildcard, neverAsk:neverAsk});
  },

  async _getAssignment(tab) {
    const cookieStore = this.getUserContextIdFromCookieStore(tab);
    // Ensure we have a cookieStore to assign to
    if (cookieStore
        && this.isTabPermittedAssign(tab)) {
      return await this.storageArea.matchUrl(tab.url);
    }
    return false;
  },

  _getByContainer(userContextId) {
    return this.storageArea.getByContainer(userContextId);
  },

  removeContextMenu() {
    // There is a focus issue in this menu where if you change window with a context menu click
    // you get the wrong menu display because of async
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1215376#c16
    // We also can't change for always private mode
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1352102
    browser.contextMenus.remove(this.MENU_ASSIGN_ID);
    browser.contextMenus.remove(this.MENU_REMOVE_ID);
    browser.contextMenus.remove(this.MENU_SEPARATOR_ID);
    browser.contextMenus.remove(this.MENU_HIDE_ID);
    browser.contextMenus.remove(this.MENU_MOVE_ID);
  },

  async calculateContextMenu(tab) {
    this.removeContextMenu();
    const siteSettings = await this._getAssignment(tab);
    // Return early and not add an item if we have false
    // False represents assignment is not permitted
    if (siteSettings === false) {
      return false;
    }
    let checked = false;
    let menuId = this.MENU_ASSIGN_ID;
    const tabUserContextId = this.getUserContextIdFromCookieStore(tab);
    if (siteSettings &&
        Number(siteSettings.userContextId) === Number(tabUserContextId)) {
      checked = true;
      menuId = this.MENU_REMOVE_ID;
    }
    browser.contextMenus.create({
      id: menuId,
      title: "Always Open in This Container",
      checked,
      type: "checkbox",
      contexts: ["all"],
    });

    browser.contextMenus.create({
      id: this.MENU_SEPARATOR_ID,
      type: "separator",
      contexts: ["all"],
    });

    browser.contextMenus.create({
      id: this.MENU_HIDE_ID,
      title: "Hide This Container",
      contexts: ["all"],
    });

    browser.contextMenus.create({
      id: this.MENU_MOVE_ID,
      title: "Move Tabs to a New Window",
      contexts: ["all"],
    });
  },

  encodeURLProperty(url) {
    return encodeURIComponent(url).replace(/[!'()*]/g, (c) => {
      const charCode = c.charCodeAt(0).toString(16);
      return `%${charCode}`;
    });
  },

  reloadPageInContainer(url, currentUserContextId, userContextId, index, active, neverAsk = false, openerTabId = null) {
    const cookieStoreId = backgroundLogic.cookieStoreId(userContextId);
    const loadPage = browser.extension.getURL("confirm-page.html");
    // False represents assignment is not permitted
    // If the user has explicitly checked "Never Ask Again" on the warning page we will send them straight there
    if (neverAsk) {
      browser.tabs.create({url, cookieStoreId, index, active, openerTabId});
    } else {
      let confirmUrl = `${loadPage}?url=${this.encodeURLProperty(url)}&cookieStoreId=${cookieStoreId}`;
      let currentCookieStoreId;
      if (currentUserContextId) {
        currentCookieStoreId = backgroundLogic.cookieStoreId(currentUserContextId);
        confirmUrl += `&currentCookieStoreId=${currentCookieStoreId}`;
      }
      browser.tabs.create({
        url: confirmUrl,
        cookieStoreId: currentCookieStoreId,
        openerTabId,
        index,
        active
      }).then(() => {
        // We don't want to sync this URL ever nor clutter the users history
        browser.history.deleteUrl({url: confirmUrl});
      }).catch((e) => {
        throw e;
      });
    }
  },

  async initBookmarksMenu() {
    browser.contextMenus.create({
      id: this.OPEN_IN_CONTAINER,
      title: "Open Bookmark in Container Tab",
      contexts: ["bookmark"],
    });

    const identities = await browser.contextualIdentities.query({});
    for (const identity of identities) {
      browser.contextMenus.create({
        parentId: this.OPEN_IN_CONTAINER,
        id: identity.cookieStoreId,
        title: identity.name,
        icons: { "16": `img/usercontext.svg#${identity.icon}` }
      });
    }
  },

  async removeBookmarksMenu() {
    browser.contextMenus.remove(this.OPEN_IN_CONTAINER);
    const identities = await browser.contextualIdentities.query({});
    for (const identity of identities) {
      browser.contextMenus.remove(identity.cookieStoreId);
    }
  }
};

assignManager.init();
