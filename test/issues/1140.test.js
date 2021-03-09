describe("#1140", () => {
  beforeEach(async () => {
    await buildBackgroundDom();
  });

  describe("removing containers", () => {
    beforeEach(async () => {
      background.browser.contextualIdentities.onRemoved.addListener = sinon.stub();
      const [promise] = background.browser.runtime.onMessage.addListener.yield({
        method: "deleteContainer",
        message: {
          userContextId: "1"
        }
      });
      await promise;
      await nextTick();
    });

    it("should remove the identitystate from storage as well", async () => {
      background.browser.storage.local.remove.should.have.been.calledWith([
        "identitiesState@@_firefox-container-1"
      ]);
    });
  });
});