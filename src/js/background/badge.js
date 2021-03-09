const MAJOR_VERSIONS = ["2.3.0", "2.4.0", "6.2.0"];
const badge = {
  async init() {    
    this.displayBrowserActionBadge("showVersionIndicator");
  },

  disableAddon(tabId) {
    browser.browserAction.disable(tabId);
    browser.browserAction.setTitle({ tabId, title: "Containers disabled in Private Browsing Mode" });
  },

  async displayBrowserActionBadge(action) { 
    const extensionInfo = await backgroundLogic.getExtensionInfo();
    function changeBadgeColorText(color, text){
      browser.browserAction.setBadgeBackgroundColor({color: color});
      browser.browserAction.setBadgeText({text: text});
    }
    if(action==="showVersionIndicator") {    
      const ActionBadgesClickedStorage = await browser.storage.local.get({browserActionBadgesClicked: []});
      if (MAJOR_VERSIONS.indexOf(extensionInfo.version) > -1 &&
          ActionBadgesClickedStorage.browserActionBadgesClicked.indexOf(extensionInfo.version) < 0) {
        changeBadgeColorText("rgba(0,217,0,255)", "NEW");
      }
    }
    else if (action==="showAchievement") {
      const achievementsStorage = await browser.storage.local.get({achievements: []});
      achievementsStorage.achievements.push({"name": "manyContainersOpened", "done": false});
      // use set and spread to create a unique array
      const achievements = [...new Set(achievementsStorage.achievements)];
      browser.storage.local.set({achievements});
      changeBadgeColorText("rgba(0,217,0,255)", "NEW");
    }
  }
    
};

badge.init();
