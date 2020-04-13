const {initializeWithTab} = require("../common");

describe("Remove multiple Containers", function () {
  beforeEach(async function () {
    this.webExt = await initializeWithTab();
  });

  afterEach(function () {
    this.webExt.destroy();
  });

  describe("creating three new containers", function () {
    beforeEach(async function () {
      for (let i = 0; i < 3; i++) {
        await this.webExt.popup.helper.clickElementById("container-add-link");
        await this.webExt.popup.helper.clickElementById("edit-container-ok-link");
      }
    });

    it("should create these in the browser as well", function () {
      this.webExt.background.browser.contextualIdentities.create.should.have.been.calledThrice;
    });

    describe("manually select one container and delete by delete button", function () {
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");
        await this.webExt.popup.helper.clickElementByQuerySelectorAll(".select-container", "last");
        await this.webExt.popup.helper.clickElementById("delete-link");
        await this.webExt.popup.helper.clickElementById("delete-container-ok-link");
      });

      it("should remove it in the browser as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-7");
      });
    });

    describe("manually select one container and delete by backspace key", function () {
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");
        await this.webExt.popup.helper.clickElementByQuerySelectorAll(".select-container", "last");

        const backspaceKey = 6;
        const event = new this.webExt.popup.window.KeyboardEvent("keydown",{"keyCode": backspaceKey});
        this.webExt.popup.window.document.dispatchEvent(event);

        await this.webExt.popup.helper.clickElementById("delete-container-ok-link");


      });

      it("should remove it in the browser as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-7");
      });
    });

    describe("manually select one container and delete by delete key", function () {
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");
        await this.webExt.popup.helper.clickElementByQuerySelectorAll(".select-container", "last");

        const deleteKey = 46;
        const event = new this.webExt.popup.window.KeyboardEvent("keydown",{"keyCode": deleteKey});
        this.webExt.popup.window.document.dispatchEvent(event);

        await this.webExt.popup.helper.clickElementById("delete-container-ok-link");


      });

      it("should remove it in the browser as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-7");
      });
    });

    describe("manually click select two containers and delete by delete button", function () {
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");

        const nodeArray = Array.from(this.webExt.popup.window.document.querySelectorAll(".select-container"));
        nodeArray[5].click();
        nodeArray[6].click();

        await this.webExt.popup.helper.clickElementById("delete-link");
        await this.webExt.popup.helper.clickElementById("delete-container-ok-link");

      });

      it("should remove it in the browser twice as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledTwice;
      });

      it("should remove the container # 7 as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-7");
      });

      it("should remove the container # 6 as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-6");
      });
    });

    describe("manually shift click select multiple containers and delete by delete button", function () {
      beforeEach(async function () {
        await this.webExt.popup.helper.clickElementById("edit-containers-link");

        const nodeArray = Array.from(this.webExt.popup.window.document.querySelectorAll(".select-container"));
        nodeArray[4].click();

        const shiftKey = 16;
        const event = new this.webExt.popup.window.KeyboardEvent("keydown",{"keyCode": shiftKey});
        this.webExt.popup.window.document.dispatchEvent(event);

        nodeArray[6].click();

        await this.webExt.popup.helper.clickElementById("delete-link");
        await this.webExt.popup.helper.clickElementById("delete-container-ok-link");

      });

      it("should remove these three containers in the browser as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledThrice;
      });

      it("should remove the container # 5 as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-5");
      });

      it("should remove the container # 6 as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-6");
      });

      it("should remove the container # 7 as well", function () {
        this.webExt.background.browser.contextualIdentities.remove.should.have.been.calledWith("firefox-container-7");
      });
    });
  });
});