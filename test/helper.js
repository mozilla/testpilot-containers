module.exports = {
  browser: {
    async initializeWithTab(details = {
      cookieStoreId: "firefox-default"
    }) {
      let tab;
      await buildDom({
        background: {
          async afterBuild(background) {
            tab = await background.browser.tabs._create(details);
          }
        },
        popup: {
          // Required to access variables, because nyc messes up 'eval'
          script: "function evalScript(v) { return eval(v); }",
          jsdom: {
            beforeParse(window) {
              window.browser.storage.local.set({
                "browserActionBadgesClicked": [],
                "onboarding-stage": 5,
                "achievements": []
              });
              window.browser.storage.local.set.resetHistory();
            }
          }
        }
      });

      return tab;
    },

    async openNewTab(tab, options = {}) {
      return background.browser.tabs._create(tab, options);
    }
  },

  popup: {
    async clickElementById(id) {
      await popup.helper.clickElementById(id);
    },

    async clickLastMatchingElementByQuerySelector(querySelector) {
      await popup.helper.clickElementByQuerySelectorAll(querySelector, "last");
    },
    
    // Wildcard subdomains: https://github.com/mozilla/multi-account-containers/issues/473
    async setWildcard(tab, wildcard) {
      const Logic = popup.window.evalScript("Logic");
      const userContextId = Logic.userContextId(tab.cookieStoreId);
      await Logic.setOrRemoveWildcard(tab.id, tab.url, userContextId, wildcard);
    }
  }
};
