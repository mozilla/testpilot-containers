if (!process.listenerCount("unhandledRejection")) {
  // eslint-disable-next-line no-console
  process.on("unhandledRejection", r => console.log(r));
}

const path = require("path");
const chai = require("chai");
const sinonChai = require("sinon-chai");
const crypto = require("crypto");
const sinon = require("sinon");
const expect = chai.expect;
chai.should();
chai.use(sinonChai);
const nextTick = () => {
  return new Promise(resolve => {
    setTimeout(() => {
      process.nextTick(resolve);
    });
  });
};

const webExtensionsJSDOM = require("webextensions-jsdom");
const manifestPath = path.resolve(path.join(__dirname, "../src/manifest.json"));

const buildDom = async ({background = {}, popup = {}}) => {
  background = {
    ...background,
    jsdom: {
      ...background.jsom,
      beforeParse(window) {
        window.browser.permissions.getAll.resolves({permissions: ["bookmarks"]});
        window.crypto = {
          getRandomValues: arr => crypto.randomBytes(arr.length),
        };
      }
    }
  };

  popup = {
    ...popup,
    jsdom: {
      ...popup.jsdom,
      pretendToBeVisual: true
    }
  };
  
  const webExtension = await webExtensionsJSDOM.fromManifest(manifestPath, {
    apiFake: true,
    wiring: true,
    sinon: global.sinon,
    background,
    popup
  });

  webExtension.browser = webExtension.background.browser;
  return webExtension;
};

const buildBackgroundDom = background => {
  return buildDom({
    background,
    popup: false
  });
};

const buildPopupDom = popup => {
  return buildDom({
    popup,
    background: false
  });
};

const initializeWithTab = async (details = {
  cookieStoreId: "firefox-default"
}) => {
  let tab;
  const webExtension = await buildDom({
    background: {
      async afterBuild(background) {
        tab = await background.browser.tabs._create(details);
      }
    },
    popup: {
      jsdom: {
        beforeParse(window) {
          window.browser.storage.local.set({
            "browserActionBadgesClicked": [],
            "onboarding-stage": 7,
            "achievements": [], 
            "syncEnabled": true,
            "replaceTabEnabled": false
          });
          window.browser.storage.local.set.resetHistory();
          window.browser.storage.sync.clear();
        }
      }
    }
  });
  webExtension.tab = tab;

  return webExtension;
};

module.exports = {
  buildDom,
  buildBackgroundDom,
  buildPopupDom,
  initializeWithTab,
  sinon,
  expect,
  nextTick,
};