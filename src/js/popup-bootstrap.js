/**
  Some of the Web Extension API (e.g. tabs, contextualIdentities) is unavailable
  if popup is hosted in an iframe on a web page. So must forward those calls
  to (privileged) background script, so that popup can be run in an iframe.
 */
const browserAPIInjector = { // eslint-disable-line no-unused-vars
  async injectAPI() {
    await this.injectMethods([
      "tabs.get",
      "tabs.query",
      "contextualIdentities.query",
      "contextualIdentities.get"
    ]);
    await this.injectConstants([
      "tabs.TAB_ID_NONE",
      "windows.WINDOW_ID_CURRENT"
    ]);
    await this.injectUnimplemented([
      "tabs.onUpdated.addListener",
      "tabs.onUpdated.removeListener"
    ]);
  },
  
  injectMethods(keys)       { return this.inject(keys, "method"); },
  injectConstants(keys)     { return this.inject(keys, "constant"); },
  injectUnimplemented(keys) { return this.inject(keys, "unimplemented"); },
  
  async inject(keys, type) {
    return Promise.all(keys.map(async (key) => {
      const [object, property] = this.getComponents(key);
      if (!(property in object)) {
        if (type === "constant") {
          object[property] = await this.invokeBrowserMethod(key);
        } else if (type === "unimplemented") {
          object[property] = () => {};
        } else {
          object[property] = async (...args) => { return this.invokeBrowserMethod(key, args); };
        }
      }
    }));
  },
  
  getComponents(key) {
    let object = browser;
    let indexOfDot;
    while ((indexOfDot = key.indexOf(".")) !== -1) {
      const property = key.substring(0, indexOfDot);
      if (!(property in object)) { object[property] = {}; }
      object = object[property];
      key = key.substring(indexOfDot + 1);
    }
    return [object, key];
  },
  
  async invokeBrowserMethod(name, args) {
    return browser.runtime.sendMessage({ method:"invokeBrowserMethod", name, args });
  }
};