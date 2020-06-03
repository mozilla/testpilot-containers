window.identityState = {
  keyboardShortcut: {},
  storageArea: {
    area: browser.storage.local,

    getContainerStoreKey(cookieStoreId) {
      const storagePrefix = "identitiesState@@_";
      return `${storagePrefix}${cookieStoreId}`;
    },

    async get(cookieStoreId) {
      const storeKey = this.getContainerStoreKey(cookieStoreId);
      const storageResponse = await this.area.get([storeKey]);
      if (storageResponse && storeKey in storageResponse) {
        if (!storageResponse[storeKey].macAddonUUID){
          storageResponse[storeKey].macAddonUUID = uuidv4();
          await this.set(cookieStoreId, storageResponse[storeKey]);
        }
        return storageResponse[storeKey];
      }
      // If local storage doesn't have an entry, look it up to make sure it's
      // an in-use identity.
      const identities = await browser.contextualIdentities.query({});
      const match = identities.find(
        (identity) => identity.cookieStoreId === cookieStoreId);
      if (match) {
        const defaultContainerState = identityState._createIdentityState();
        await this.set(cookieStoreId, defaultContainerState);
        return defaultContainerState;
      }
      return false;
    },

    set(cookieStoreId, data) {
      const storeKey = this.getContainerStoreKey(cookieStoreId);
      return this.area.set({
        [storeKey]: data
      });
    },

    async remove(cookieStoreId) {
      const storeKey = this.getContainerStoreKey(cookieStoreId);
      return this.area.remove([storeKey]);
    },

    async setKeyboardShortcut(shortcutId, cookieStoreId) {
      identityState.keyboardShortcut[shortcutId] = cookieStoreId;
      return this.area.set({[shortcutId]: cookieStoreId});
    },

    async loadKeyboardShortcuts () {
      const identities = await browser.contextualIdentities.query({});
      for (let i=0; i < backgroundLogic.NUMBER_OF_KEYBOARD_SHORTCUTS; i++) {
        const key = "open_container_" + i;
        const storageObject = await this.area.get(key);
        if (storageObject[key]){
          identityState.keyboardShortcut[key] = storageObject[key];
          continue;
        }
        if (identities[i]) {
          identityState.keyboardShortcut[key] = identities[i].cookieStoreId;
          continue;
        }
        identityState.keyboardShortcut[key] = "none";
      }
      return identityState.keyboardShortcut;
    },

    /*
     * Looks for abandoned identity keys in local storage, and makes sure all
     * identities registered in the browser are also in local storage. (this
     * appears to not always be the case based on how this.get() is written)
     */
    async upgradeData() {
      const identitiesList = await browser.contextualIdentities.query({});

      for (const identity of identitiesList) {
        // ensure all identities have an entry in local storage
        await identityState.addUUID(identity.cookieStoreId);
      }
      
      const macConfigs = await this.area.get();
      for(const configKey of Object.keys(macConfigs)) {
        if (configKey.includes("identitiesState@@_")) {
          const cookieStoreId = String(configKey).replace(/^identitiesState@@_/, "");
          const match = identitiesList.find(
            localIdentity => localIdentity.cookieStoreId === cookieStoreId
          );
          if (cookieStoreId === "firefox-default") continue;
          if (!match) {
            await this.remove(cookieStoreId);
            continue;
          }
          if (!macConfigs[configKey].macAddonUUID) {
            await identityState.storageArea.get(cookieStoreId);
          }
        }
      }
    },

  },

  _createTabObject(tab) {
    return Object.assign({}, tab);
  },

  async getCookieStoreIDuuidMap() {
    const containers = {};
    const identities = await browser.contextualIdentities.query({});
    for(const identity of identities) {
      const containerInfo = await this.storageArea.get(identity.cookieStoreId);
      containers[identity.cookieStoreId] = containerInfo.macAddonUUID;
    }
    return containers;
  },

  async storeHidden(cookieStoreId, windowId) {
    const containerState = await this.storageArea.get(cookieStoreId);
    const tabsByContainer = await browser.tabs.query({cookieStoreId, windowId});
    tabsByContainer.forEach((tab) => {
      const tabObject = this._createTabObject(tab);
      if (!backgroundLogic.isPermissibleURL(tab.url)) {
        return;
      }
      // This tab is going to be closed. Let's mark this tabObject as
      // non-active.
      tabObject.active = false;
      tabObject.hiddenState = true;
      containerState.hiddenTabs.push(tabObject);
    });

    return this.storageArea.set(cookieStoreId, containerState);
  },

  async updateUUID(cookieStoreId, uuid) {
    if (!cookieStoreId || !uuid) {
      throw new Error ("cookieStoreId or uuid missing");
    }
    const containerState = await this.storageArea.get(cookieStoreId);
    containerState.macAddonUUID = uuid;
    await this.storageArea.set(cookieStoreId, containerState);
    return uuid;
  },

  async addUUID(cookieStoreId) {
    await this.storageArea.get(cookieStoreId);
  },

  async lookupMACaddonUUID(cookieStoreId) {
    // This stays a lookup, because if the cookieStoreId doesn't 
    // exist, this.get() will create it, which is not what we want.
    const cookieStoreIdKey = cookieStoreId.includes("firefox-container-") ? 
      cookieStoreId : "firefox-container-" + cookieStoreId;
    const macConfigs = await this.storageArea.area.get();
    for(const configKey of Object.keys(macConfigs)) {
      if (configKey === this.storageArea.getContainerStoreKey(cookieStoreIdKey)) {
        return macConfigs[configKey].macAddonUUID;
      }
    }
    return false;
  },

  async lookupCookieStoreId(macAddonUUID) {
    const macConfigs = await this.storageArea.area.get();
    for(const configKey of Object.keys(macConfigs)) {
      if (configKey.includes("identitiesState@@_")) {
        if(macConfigs[configKey].macAddonUUID === macAddonUUID) {
          return String(configKey).replace(/^identitiesState@@_/, "");
        }
      }
    }
    return false;
  },

  _createIdentityState() {
    return {
      hiddenTabs: [],
      macAddonUUID: uuidv4()
    };
  },

  init() {
    this.storageArea.loadKeyboardShortcuts();
  }
};

identityState.init();

function uuidv4() {
  // https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}
