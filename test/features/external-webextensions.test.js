describe("External Webextensions", () => {
  const url = "http://example.com";

  beforeEach(async () => {
    await helper.browser.initializeWithTab({
      cookieStoreId: "firefox-container-1",
      url
    });
    await helper.popup.clickElementById("container-page-assigned");
  });

  describe("with contextualIdentities permissions", () => {
    it("should be able to get assignments", async () => {
      background.browser.management.get.resolves({
        permissions: ["contextualIdentities"]
      });

      const message = {
        method: "getAssignment",
        url
      };
      const sender = {
        id: "external-webextension"
      };

      const [promise] = background.browser.runtime.onMessageExternal.addListener.yield(message, sender);
      const answer = await promise;
      expect(answer).to.deep.include({
        userContextId: "1",
        neverAsk: false
      });
    });
  });

  describe("without contextualIdentities permissions", () => {
    it("should throw an error", async () => {
      background.browser.management.get.resolves({
        permissions: []
      });

      const message = {
        method: "getAssignment",
        url
      };
      const sender = {
        id: "external-webextension"
      };

      const [promise] = background.browser.runtime.onMessageExternal.addListener.yield(message, sender);
      return promise.catch(error => {
        expect(error.message).to.equal("Missing contextualIdentities permission");
      });
    });
  });
});
