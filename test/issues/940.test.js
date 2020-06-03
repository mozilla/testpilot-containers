const {expect, sinon, initializeWithTab} = require("../common");

describe("#940", function () {
  describe("when other onBeforeRequestHandlers are faster and redirect with the same requestId", function () {
    it("should not open two confirm pages", async function () {
      const webExtension = await initializeWithTab({
        cookieStoreId: "firefox-container-4",
        url: "http://example.com"
      });

      await webExtension.popup.helper.clickElementById("always-open-in");
      await webExtension.popup.helper.clickElementByQuerySelectorAll("#picker-identities-list > .menu-item");

      const responses = {};
      await webExtension.background.browser.tabs._create({
        url: "https://example.com"
      }, {
        options: {
          webRequestRedirects: ["https://example.com"],
          webRequestError: true,
          instantRedirects: true
        },
        responses
      });

      const result = await responses.webRequest.onBeforeRequest[1];
      expect(result).to.deep.equal({
        cancel: true
      });
      webExtension.browser.tabs.create.should.have.been.calledOnce;

      webExtension.destroy();
    });
  });

  describe("when redirects change requestId midflight", function () {
    beforeEach(async function () {
      
      this.webExt = await initializeWithTab({
        cookieStoreId: "firefox-container-4",
        url: "https://www.youtube.com"
      });

      await this.webExt.popup.helper.clickElementById("always-open-in");
      await this.webExt.popup.helper.clickElementByQuerySelectorAll("#picker-identities-list > .menu-item");
      
      global.clock = sinon.useFakeTimers();
      this.redirectedRequest = async (options = {}) => {
        const newTabResponses = {};
        const newTab = await this.webExt.browser.tabs._create({
          url: "http://youtube.com"
        }, {
          options: Object.assign({
            webRequestRedirects: [
              "https://youtube.com",
              "https://www.youtube.com",
              {
                url: "https://www.youtube.com",
                webRequest: {
                  requestId: 2
                }
              }
            ],
            webRequestError: true,
            instantRedirects: true
          }, options),
          responses: newTabResponses
        });
  
        return [newTabResponses, newTab];
      };
    });

    afterEach(function () {
      this.webExt.destroy();
      global.clock.restore();
    });

    it("should not open two confirm pages", async function () {
      const [newTabResponses] = await this.redirectedRequest();

      // http://youtube.com is not assigned, no cancel, no reopening
      expect(await newTabResponses.webRequest.onBeforeRequest[0]).to.deep.equal({});

      // https://youtube.com is not assigned, no cancel, no reopening
      expect(await newTabResponses.webRequest.onBeforeRequest[1]).to.deep.equal({});

      // https://www.youtube.com is assigned, this triggers reopening, cancel
      expect(await newTabResponses.webRequest.onBeforeRequest[2]).to.deep.equal({
        cancel: true
      });

      // https://www.youtube.com is assigned, this was a redirect, cancel early, no reopening
      expect(await newTabResponses.webRequest.onBeforeRequest[3]).to.deep.equal({
        cancel: true
      });

      this.webExt.background.browser.tabs.create.should.have.been.calledOnce;
    });

    it("should uncancel after webRequest.onCompleted", async function () {
      const [newTabResponses, newTab] = await this.redirectedRequest();
      // remove onCompleted listeners because in the real world this request would never complete
      // and thus might trigger unexpected behavior because the tab gets removed when reopening
      this.webExt.background.browser.webRequest.onCompleted.addListener = sinon.stub();
      this.webExt.background.browser.tabs.create.resetHistory();
      // we create a tab with the same id and use the same request id to see if uncanceled
      await this.webExt.browser.tabs._create({
        id: newTab.id,
        url: "https://www.youtube.com"
      }, {
        options: {
          webRequest: {
            requestId: newTabResponses.webRequest.request.requestId
          }
        }
      });

      this.webExt.background.browser.tabs.create.should.have.been.calledOnce;
    });

    it("should uncancel after webRequest.onErrorOccurred", async function () {
      const [newTabResponses, newTab] = await this.redirectedRequest();
      this.webExt.background.browser.tabs.create.resetHistory();
      // we create a tab with the same id and use the same request id to see if uncanceled
      await this.webExt.browser.tabs._create({
        id: newTab.id,
        url: "https://www.youtube.com"
      }, {
        options: {
          webRequest: {
            requestId: newTabResponses.webRequest.request.requestId
          },
          webRequestError: true
        }
      });

      this.webExt.background.browser.tabs.create.should.have.been.calledOnce;
    });

    it("should uncancel after 2 seconds", async function () {
      const [newTabResponses, newTab] = await this.redirectedRequest({
        webRequestDontYield: ["onCompleted", "onErrorOccurred"]
      });
      global.clock.tick(2000);

      this.webExt.background.browser.tabs.create.resetHistory();
      // we create a tab with the same id and use the same request id to see if uncanceled
      await this.webExt.browser.tabs._create({
        id: newTab.id,
        url: "https://www.youtube.com"
      }, {
        options: {
          webRequest: {
            requestId: newTabResponses.webRequest.request.requestId
          },
          webRequestError: true
        }
      });

      this.webExt.background.browser.tabs.create.should.have.been.calledOnce;
    });

    it("should not influence the canceled url in other tabs", async function () {
      await this.redirectedRequest();
      this.webExt.background.browser.tabs.create.resetHistory();
      await this.webExt.browser.tabs._create({
        cookieStoreId: "firefox-default",
        url: "https://www.youtube.com"
      }, {
        options: {
          webRequestError: true
        }
      });

      this.webExt.background.browser.tabs.create.should.have.been.calledOnce;
    });
  });
});
