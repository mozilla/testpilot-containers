const {expect, initializeWithTab} = require("../common");

describe("External Webextensions", function () {
  const url = "http://example.com";

  beforeEach(async function () {
    this.webExt = await initializeWithTab({
      cookieStoreId: "firefox-container-4",
      url
    });

    await this.webExt.popup.helper.clickElementById("always-open-in");
    await this.webExt.popup.helper.clickElementByQuerySelectorAll("#picker-identities-list > .menu-item", "last");
  });

  afterEach(function () {
    this.webExt.destroy();
  });

  describe("with contextualIdentities permissions", function () {
    it("should be able to get assignments", async function () {
      this.webExt.background.browser.management.get.resolves({
        permissions: ["contextualIdentities"]
      });

      const message = {
        method: "getAssignment",
        url
      };
      const sender = {
        id: "external-webextension"
      };

      const [promise] = this.webExt.background.browser.runtime.onMessageExternal.addListener.yield(message, sender);
      const answer = await promise;
      expect(answer.userContextId === "4").to.be.true;
      expect(answer.neverAsk === false).to.be.true;
      expect(
        Object.prototype.hasOwnProperty.call(
          answer, "identityMacAddonUUID")).to.be.true;
    });
  });

  describe("without contextualIdentities permissions", function () {
    it("should throw an error", async function () {
      this.webExt.background.browser.management.get.resolves({
        permissions: []
      });

      const message = {
        method: "getAssignment",
        url
      };
      const sender = {
        id: "external-webextension"
      };

      const [promise] = this.webExt.background.browser.runtime.onMessageExternal.addListener.yield(message, sender);
      return promise.catch(error => {
        expect(error.message).to.equal("Missing contextualIdentities permission");
      });
    });
  });
});
