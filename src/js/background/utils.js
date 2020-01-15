const utils = { // eslint-disable-line no-unused-vars

  // Copy object and remove keys with predicate
  filterObj(obj, predicate) {
    if (obj && typeof obj !== "object") { throw new Error(`Invalid arg: ${obj}`); }
    if (!obj) { return {}; }
    return Object.assign({}, ...Object.entries(obj).map(([k,v]) => {
      if (predicate(k, v)) {
        return { [k]: v };
      } else {
        return null;
      }
    }));    
  },
    
  // Store data in a named storage area.
  // 
  // (Note that all data for all stores is stored in the same single storage area,
  // but this class provides accessor methods to get/set only the data that applies
  // to one specific named store, as identified in the constructor.)
  NamedStore: class {
    constructor(name) {
      this.prefix = `${name}@@_`;
    }

    _storeKeyForKey(key) {
      if (Array.isArray(key)) {
        return key.map(oneKey => oneKey.startsWith(this.prefix) ? oneKey : `${this.prefix}${oneKey}`);
      } else if (key) {
        return key.startsWith(this.prefix) ? key : `${this.prefix}${key}`;
      } else {
        return null;
      }
    }
  
    _keyForStoreKey(storeKey) {
      if (Array.isArray(storeKey)) {
        return storeKey.map(oneStoreKey => oneStoreKey.startsWith(this.prefix) ? oneStoreKey.substring(this.prefix.length) : null);
      } else if (storeKey) {
        return storeKey.startsWith(this.prefix) ? storeKey.substring(this.prefix.length) : null;
      } else {
        return null;
      }
    }
  
    get(key) {
      if (typeof key !== "string") { return Promise.reject(new Error(`Invalid arg: ${key}`)); }  
      const storeKey = this._storeKeyForKey(key);
      return new Promise((resolve, reject) => {
        browser.storage.local.get([storeKey]).then((storageResponse) => {
          if (storeKey in storageResponse) {
            resolve(storageResponse[storeKey]);
          } else {
            resolve(null);
          }
        }).catch((e) => {
          reject(e);
        });
      });
    }

    getAll(keys) {
      if (keys && !Array.isArray(keys)) { return Promise.reject(new Error(`Invalid arg: ${keys}`)); }
      const storeKeys = this._storeKeyForKey(keys);
      return new Promise((resolve, reject) => {
        browser.storage.local.get(storeKeys).then((storageResponse) => {
          if (storageResponse) {
            resolve(Object.assign({}, ...Object.entries(storageResponse).map(([oneStoreKey, data]) => {
              const key = this._keyForStoreKey(oneStoreKey);
              return key ? { [key]: data } : null;
            })));
          } else {
            resolve({});
          }
        }).catch((e) => {
          reject(e);
        });
      });
    }
    
    async getSome(predicate) {
      const all = await this.getAll();
      return utils.filterObj(all, predicate);
    }
  
    set(key, data) {
      if (typeof key !== "string") { return Promise.reject(new Error(`Invalid arg: ${key}`)); }
      const storeKey = this._storeKeyForKey(key);
      return browser.storage.local.set({
        [storeKey]: data
      });
    }

    remove(key) {
      if (typeof key !== "string") { return Promise.reject(new Error(`Invalid arg: ${key}`)); }
      const storeKey = this._storeKeyForKey(key);
      return browser.storage.local.remove(storeKey);
    }
  
    removeAll(keys) {
      if (keys && !Array.isArray(keys)) { return Promise.reject(new Error(`Invalid arg: ${keys}`)); }
      const storeKeys = this._storeKeyForKey(keys);
      return browser.storage.local.remove(storeKeys);
    }
  }
};