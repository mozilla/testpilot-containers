// Wildcard subdomains: https://github.com/mozilla/multi-account-containers/issues/473
describe("Wildcard Subdomains Feature", () => {
  const url1 = "http://www.example.com";
  const url2 = "http://mail.example.com";

  let activeTab;
  beforeEach(async () => {
    activeTab = await helper.browser.initializeWithTab({
      cookieStoreId: "firefox-container-1",
      url: url1
    });
  });

  describe("click the 'Always open in' checkbox in the popup", () => {
    beforeEach(async () => {
      // popup click to set assignment for activeTab.url
      await helper.popup.clickElementById("container-page-assigned");
    });

    describe("click the assigned URL's subdomain to convert it to a wildcard", () => {
      beforeEach(async () => {
        await helper.popup.setWildcard(activeTab, "example.com");
      });

      describe("open new Tab with a different subdomain in the default container", () => {
        let newTab;
        beforeEach(async () => {
          // new Tab opening activeTab.url in default container
          newTab = await helper.browser.openNewTab({
            cookieStoreId: "firefox-default",
            url: url2
          }, {
            options: {
              webRequestError: true // because request is canceled due to reopening
            }
          });
        });

        it("should open the confirm page", async () => {
          // should have created a new tab with the confirm page
          background.browser.tabs.create.should.have.been.calledWithMatch({
            url: "moz-extension://fake/confirm-page.html?" +
                 `url=${encodeURIComponent(url2)}` +
                 `&cookieStoreId=${activeTab.cookieStoreId}`,
            cookieStoreId: undefined,
            openerTabId: null,
            index: 2,
            active: true
          });
        });

        it("should remove the new Tab that got opened in the default container", () => {
          background.browser.tabs.remove.should.have.been.calledWith(newTab.id);
        });
      });
    });
  });
});
