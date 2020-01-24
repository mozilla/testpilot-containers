describe("Recording Feature", () => {
  const url1 = "http://example.com";
  const url2 = "http://example2.com";
  let recordingTab;
  beforeEach(async () => {
    recordingTab = await helper.browser.initializeWithTab({
      cookieStoreId: "firefox-container-1",
      url: url1
    });
  });

  describe("click the 'Record' button in the popup", () => {
    beforeEach(async () => {
      await helper.popup.clickElementById("record-link");
    });

    describe("browse to a website", () => {
      beforeEach(async () => {
        await helper.browser.browseToURL(recordingTab.id, url1);
      });
  
      describe("browse to another website", () => {
        beforeEach(async () => {
          await helper.browser.browseToURL(recordingTab.id, url2);
        });
  
        describe("click the 'Exit Record Mode' button in the popup", () => {
          beforeEach(async () => {
            await helper.popup.clickElementById("exit-record-mode-link");
          });
  
          describe("in a new tab open the first website", () => {
            beforeEach(async () => {
              await helper.browser.openNewTab({
                cookieStoreId: "firefox-default",
                url: url1
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
                     `url=${encodeURIComponent(url1)}` +
                     `&cookieStoreId=${recordingTab.cookieStoreId}`,
                cookieStoreId: undefined,
                openerTabId: null,
                index: 2,
                active: true
              });
            });
            
            describe("in another new tab, open the second website", () => {
              beforeEach(async () => {
                await helper.browser.openNewTab({
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
                       `&cookieStoreId=${recordingTab.cookieStoreId}`,
                  cookieStoreId: undefined,
                  openerTabId: null,
                  index: 3,
                  active: true
                });
              });
            });
          });
        });
      });
    });
  });
});
