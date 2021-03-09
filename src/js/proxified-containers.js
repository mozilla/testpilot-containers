// This object allows other scripts to access the list mapping containers to their proxies
proxifiedContainers = {

  // Slightly modified version of 'retrieve' which returns a direct proxy whenever an error is met.
  retrieveFromBackground(cookieStoreId = null) {
    return new Promise((resolve, reject) => {
      proxifiedContainers.retrieve(cookieStoreId).then((success) => {
        resolve(success.proxy);
      }, function() {
        resolve(Utils.DEFAULT_PROXY);
      }).catch((error) => {
        reject(error);
      });
    });
  },

  report_proxy_error(error, identifier = null) {
    // Currently I print to console but this is inefficient
    const relevant_id_str = identifier === null ? "" : ` call supplied with id: ${identifier.toString()}`;
    browser.extension.getBackgroundPage().console.log(`proxifiedContainers error occured ${relevant_id_str}: ${JSON.stringify(error)}`);
  },

  // Resolves to a proxy object which can be used in the return of the listener required for browser.proxy.onRequest.addListener
  retrieve(cookieStoreId = null) {
    return new Promise((resolve, reject) => {
      browser.storage.local.get("proxifiedContainersKey").then((results) => {
        // Steps to test:
        // 1. Is result empty? If so we must inform the caller to intialize proxifiedContainersStore with some initial info.
        // 2. Is cookieStoreId null? This means the caller probably wants everything currently in the proxifiedContainersStore object store
        // 3. If there doesn't exist an entry for the associated cookieStoreId, inform the caller of this
        // 4. Normal operation - if the cookieStoreId exists in the map, we can simply resolve with the correct proxy value

        const results_array = results["proxifiedContainersKey"];

        if (Object.getOwnPropertyNames(results).length === 0) {
          reject({
            error: "uninitialized",
            message: ""
          });
        } else if (cookieStoreId === null) {
          resolve(results_array);
        } else {
          const val = results_array.find(o => o.cookieStoreId === cookieStoreId);

          if (typeof val !== "object" || val === null) {
            reject({
              error: "doesnotexist",
              message: ""
            });
          } else {
            resolve(val);
          }
        }

      }, (error) => {
        reject({
          error: "internal",
          message: error
        });
      }).catch((error) => {
        proxifiedContainers.report_proxy_error(error, "proxified-containers.js: error 1");
      });
    });
  },

  set(cookieStoreId, proxy, initialize = false) {
    return new Promise((resolve, reject) => {
      if (initialize === true) {
        const proxifiedContainersStore = [];
        proxifiedContainersStore.push({
          cookieStoreId: cookieStoreId,
          proxy: proxy
        });

        browser.storage.local.set({
          proxifiedContainersKey: proxifiedContainersStore
        });

        resolve(proxy);
      }

      // Assumes proxy is a properly formatted object
      proxifiedContainers.retrieve().then((proxifiedContainersStore) => {
        let index = proxifiedContainersStore.findIndex(i => i.cookieStoreId === cookieStoreId);

        if (index === -1) {
          proxifiedContainersStore.push({
            cookieStoreId: cookieStoreId,
            proxy: proxy
          });
          index = proxifiedContainersStore.length - 1;
        } else {
          proxifiedContainersStore[index] = {
            cookieStoreId: cookieStoreId,
            proxy: proxy
          };
        }

        browser.storage.local.set({
          proxifiedContainersKey: proxifiedContainersStore
        });

        resolve(proxifiedContainersStore[index]);
      }, (errorObj) => {
        reject(errorObj);
      }).catch((error) => {
        throw error;
      });
    });
  },

  //Parses a proxy description string of the format type://host[:port] or type://username:password@host[:port] (port is optional)
  parseProxy(proxy_str) {
    const proxyRegexp = /(?<type>(https?)|(socks4?)):\/\/(\b(?<username>\w+):(?<password>\w+)@)?(?<host>((?:\d{1,3}\.){3}\d{1,3}\b)|(\b(\w+)(\.(\w+))+))(:(?<port>\d+))?/;
    if (proxyRegexp.test(proxy_str) !== true) {
      return false;
    }
    const matches = proxyRegexp.exec(proxy_str);
    return matches.groups;
  },

  // Deletes the proxy information object for a specified cookieStoreId [useful for cleaning]
  delete(cookieStoreId) {
    return new Promise((resolve, reject) => {
      // Assumes proxy is a properly formatted object
      proxifiedContainers.retrieve().then((proxifiedContainersStore) => {
        const index = proxifiedContainersStore.findIndex(i => i.cookieStoreId === cookieStoreId);

        if (index === -1) {
          reject({error: "not-found", message: `Container '${cookieStoreId}' not found.`});
        } else {
          proxifiedContainersStore.splice(index, 1);
        }

        browser.storage.local.set({
          proxifiedContainersKey: proxifiedContainersStore
        });

        resolve();
      }, (errorObj) => {
        reject(errorObj);
      }).catch((error) => {
        throw error;
      });
    });
  }
};
