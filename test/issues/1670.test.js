const {initializeWithTab} = require("../common");

describe("#1670", function () {
  beforeEach(async function () {
    this.webExt = await initializeWithTab();
  });

  afterEach(function () {
    this.webExt.destroy();
  });

  describe("creating a new container", function () {
    beforeEach(async function () {
      await this.webExt.popup.helper.clickElementById("container-add-link");
      await this.webExt.popup.helper.clickElementById("edit-container-ok-link");
    });

    it("should create it in the browser as well", function () {
      this.webExt.background.browser.contextualIdentities.create.should.have.been.calledOnce;
    });

    describe("manually assign a valid URL to a container", function () {
      const exampleUrl = "https://github.com/mozilla/multi-account-containers";
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");
        await this.webExt.popup.helper.clickElementByQuerySelectorAll(".edit-container-icon", "last");
        this.webExt.popup.window.document.getElementById("edit-container-panel-site-input").value = exampleUrl;
        await this.webExt.popup.helper.clickElementById("edit-container-site-link");
      });

      it("should assign the URL to a container", function () {
        this.webExt.background.browser.contextualIdentities.create.should.have.been.calledOnce;
      });
    });

    describe("manually assign valid URL without protocol to a container", function () {
      const exampleUrl = "github.com/mozilla/multi-account-containers";
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");
        await this.webExt.popup.helper.clickElementByQuerySelectorAll(".edit-container-icon", "last");
        this.webExt.popup.window.document.getElementById("edit-container-panel-site-input").value = exampleUrl;
        await this.webExt.popup.helper.clickElementById("edit-container-site-link");
      });

      it("should assign the URL without protocol to a container", function () {
        this.webExt.background.browser.contextualIdentities.create.should.have.been.calledOnce;
      });
    });

    describe("manually assign an invalid URL to a container", function () {
      const exampleUrl = "github";
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");
        await this.webExt.popup.helper.clickElementByQuerySelectorAll(".edit-container-icon", "last");
        this.webExt.popup.window.document.getElementById("edit-container-panel-site-input").value = exampleUrl;
        await this.webExt.popup.helper.clickElementById("edit-container-site-link");
      });

      it("should not assign the URL to a container", function () {
        this.webExt.background.browser.contextualIdentities.update.should.not.have.been.called;
      });
    });

    describe("manually assign empty URL to a container", function () {
      const exampleUrl = "";
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");
        await this.webExt.popup.helper.clickElementByQuerySelectorAll(".edit-container-icon", "last");
        this.webExt.popup.window.document.getElementById("edit-container-panel-site-input").value = exampleUrl;
        await this.webExt.popup.helper.clickElementById("edit-container-site-link");
      });

      it("should not assign the URL to a container", function () {
        this.webExt.background.browser.contextualIdentities.update.should.not.have.been.called;
      });
    });
  });
});