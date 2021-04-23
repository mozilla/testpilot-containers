/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const CONTAINER_HIDE_SRC = "/img/password-hide.svg";
const CONTAINER_UNHIDE_SRC = "/img/password-hide.svg";

const DEFAULT_COLOR = "blue";
const DEFAULT_ICON = "circle";
const NEW_CONTAINER_ID = "new";

const ONBOARDING_STORAGE_KEY = "onboarding-stage";
const CONTAINER_ORDER_STORAGE_KEY = "container-order";
const CONTAINER_DRAG_DATA_TYPE = "firefox-container";

// List of panels
const P_ONBOARDING_1 = "onboarding1";
const P_ONBOARDING_2 = "onboarding2";
const P_ONBOARDING_3 = "onboarding3";
const P_ONBOARDING_4 = "onboarding4";
const P_ONBOARDING_5 = "onboarding5";
const P_ONBOARDING_6 = "onboarding6";
const P_ONBOARDING_7 = "onboarding7";
const P_CONTAINERS_LIST = "containersList";
const OPEN_NEW_CONTAINER_PICKER = "new-tab";
const MANAGE_CONTAINERS_PICKER = "manage";
const REOPEN_IN_CONTAINER_PICKER = "reopen-in";
const ALWAYS_OPEN_IN_PICKER = "always-open-in";
const P_CONTAINER_INFO = "containerInfo";
const P_CONTAINER_EDIT = "containerEdit";
const P_CONTAINER_DELETE = "containerDelete";
const P_CONTAINERS_ACHIEVEMENT = "containersAchievement";
const P_CONTAINER_ASSIGNMENTS = "containerAssignments";

function addRemoveSiteIsolation() {
  const identity = Logic.currentIdentity();
  browser.runtime.sendMessage({
    method: "addRemoveSiteIsolation",
    cookieStoreId: identity.cookieStoreId
  });
}

async function getExtensionInfo() {
  const manifestPath = browser.extension.getURL("manifest.json");
  const response = await fetch(manifestPath);
  const extensionInfo = await response.json();
  return extensionInfo;
}

// This object controls all the panels, identities and many other things.
const Logic = {
  _identities: [],
  _currentIdentity: null,
  _currentPanel: null,
  _previousPanelPath: [],
  _panels: {},
  _onboardingVariation: null,

  async init() {
    // Remove browserAction "upgraded" badge when opening panel
    this.clearBrowserActionBadge();

    // Retrieve the list of identities.
    const identitiesPromise = this.refreshIdentities();

    try {
      await identitiesPromise;
    } catch (e) {
      throw new Error("Failed to retrieve the identities or variation. We cannot continue. ", e.message);
    }

    // Routing to the correct panel.
    // If localStorage is disabled, we don't show the onboarding.
    const onboardingData = await browser.storage.local.get([ONBOARDING_STORAGE_KEY]);
    let onboarded = onboardingData[ONBOARDING_STORAGE_KEY];
    if (!onboarded) {
      onboarded = 0;
      this.setOnboardingStage(onboarded);
    }

    switch (onboarded) {
    case 7:
      this.showAchievementOrContainersListPanel();
      break;
    case 6:
      this.showPanel(P_ONBOARDING_7);
      break;
    case 5:
      this.showPanel(P_ONBOARDING_6);
      break;
    case 4:
      this.showPanel(P_ONBOARDING_5);
      break;
    case 3:
      this.showPanel(P_ONBOARDING_4);
      break;
    case 2:
      this.showPanel(P_ONBOARDING_3);
      break;
    case 1:
      this.showPanel(P_ONBOARDING_2);
      break;
    case 0:
    default:
      this.showPanel(P_ONBOARDING_1);
      break;
    }

  },

  async showAchievementOrContainersListPanel() {
    // Do we need to show an achievement panel?
    let showAchievements = false;
    const achievementsStorage = await browser.storage.local.get({ achievements: [] });
    for (const achievement of achievementsStorage.achievements) {
      if (!achievement.done) {
        showAchievements = true;
      }
    }
    if (showAchievements) {
      this.showPanel(P_CONTAINERS_ACHIEVEMENT);
    } else {
      this.showPanel(P_CONTAINERS_LIST);
    }
  },

  // In case the user wants to click multiple actions,
  // they have to click the "Done" button to stop the panel
  // from showing
  async setAchievementDone(achievementName) {
    const achievementsStorage = await browser.storage.local.get({ achievements: [] });
    const achievements = achievementsStorage.achievements;
    achievements.forEach((achievement, index, achievementsArray) => {
      if (achievement.name === achievementName) {
        achievement.done = true;
        achievementsArray[index] = achievement;
      }
    });
    browser.storage.local.set({ achievements });
  },

  setOnboardingStage(stage) {
    return browser.storage.local.set({
      [ONBOARDING_STORAGE_KEY]: stage
    });
  },

  async clearBrowserActionBadge() {
    const extensionInfo = await getExtensionInfo();
    const storage = await browser.storage.local.get({ browserActionBadgesClicked: [] });
    browser.browserAction.setBadgeBackgroundColor({ color: null });
    browser.browserAction.setBadgeText({ text: "" });
    storage.browserActionBadgesClicked.push(extensionInfo.version);
    // use set and spread to create a unique array
    const browserActionBadgesClicked = [...new Set(storage.browserActionBadgesClicked)];
    browser.storage.local.set({
      browserActionBadgesClicked
    });
  },

  async identity(cookieStoreId) {
    const defaultContainer = {
      name: "Default",
      cookieStoreId,
      icon: "default-tab",
      color: "default-tab",
      numberOfHiddenTabs: 0,
      numberOfOpenTabs: 0
    };
    // Handle old style rejection with null and also Promise.reject new style
    try {
      return await browser.contextualIdentities.get(cookieStoreId) || defaultContainer;
    } catch (e) {
      return defaultContainer;
    }
  },

  async numTabs() {
    const activeTabs = await browser.tabs.query({ windowId: browser.windows.WINDOW_ID_CURRENT });
    return activeTabs.length;
  },

  _disableMenuItem(message, elementToDisable = document.querySelector("#move-to-new-window")) {
    elementToDisable.setAttribute("title", message);
    elementToDisable.removeAttribute("tabindex");
    elementToDisable.classList.remove("hover-highlight");
    elementToDisable.classList.add("disabled-menu-item");
  },

  _enableMenuItems(elementToEnable = document.querySelector("#move-to-new-window")) {
    elementToEnable.removeAttribute("title");
    elementToEnable.setAttribute("tabindex", "0");
    elementToEnable.classList.add("hover-highlight");
    elementToEnable.classList.remove("disabled-menu-item");
  },

  async saveContainerOrder(rows) {
    const containerOrder = {};
    rows.forEach((node, index) => {
      return containerOrder[node.dataset.containerId] = index;
    });
    await browser.storage.local.set({
      [CONTAINER_ORDER_STORAGE_KEY]: containerOrder
    });
  },

  async refreshIdentities() {
    const [identities, state, containerOrderStorage] = await Promise.all([
      browser.contextualIdentities.query({}),
      browser.runtime.sendMessage({
        method: "queryIdentitiesState",
        message: {
          windowId: browser.windows.WINDOW_ID_CURRENT
        }
      }),
      browser.storage.local.get([CONTAINER_ORDER_STORAGE_KEY])
    ]);
    const containerOrder =
      containerOrderStorage && containerOrderStorage[CONTAINER_ORDER_STORAGE_KEY];
    this._identities = identities.map((identity) => {
      const stateObject = state[identity.cookieStoreId];
      if (stateObject) {
        identity.hasOpenTabs = stateObject.hasOpenTabs;
        identity.hasHiddenTabs = stateObject.hasHiddenTabs;
        identity.numberOfHiddenTabs = stateObject.numberOfHiddenTabs;
        identity.numberOfOpenTabs = stateObject.numberOfOpenTabs;
        identity.isIsolated = stateObject.isIsolated;
      }
      if (containerOrder) {
        identity.order = containerOrder[identity.cookieStoreId];
      }
      return identity;
    }).sort((i1, i2) => i1.order - i2.order);
  },

  getPanelSelector(panel) {
    if (this._onboardingVariation === "securityOnboarding" &&
    // eslint-disable-next-line no-prototype-builtins
      panel.hasOwnProperty("securityPanelSelector")) {
      return panel.securityPanelSelector;
    } else {
      return panel.panelSelector;
    }
  },

  async showPanel(panel, currentIdentity = null, backwards = false) {
    if (!backwards || !this._currentPanel) {
      this._previousPanelPath.push(this._currentPanel);
    }

    // If invalid panel, reset panels.
    if (!(panel in this._panels)) {
      panel = P_CONTAINERS_LIST;
      this._previousPanelPath = [];
    }

    this._currentPanel = panel;

    this._currentIdentity = currentIdentity;

    // Initialize the panel before showing it.
    await this._panels[panel].prepare();
    Object.keys(this._panels).forEach((panelKey) => {
      const panelItem = this._panels[panelKey];
      const panelElement = document.querySelector(this.getPanelSelector(panelItem));
      if (!panelElement.classList.contains("hide")) {
        panelElement.classList.add("hide");
        if ("unregister" in panelItem) {
          panelItem.unregister();
        }
      }
    });
    const panelEl = document.querySelector(this.getPanelSelector(this._panels[panel]));
    panelEl.classList.remove("hide");

    const focusEl = panelEl.querySelector(".firstTabindex");
    if(focusEl) {
      focusEl.focus();
    }
  },

  showPreviousPanel() {
    if (!this._previousPanelPath) {
      throw new Error("Current panel not set!");
    }
    this.showPanel(this._previousPanelPath.pop(), this._currentIdentity, true);
  },

  registerPanel(panelName, panelObject) {
    this._panels[panelName] = panelObject;
    panelObject.initialize();
  },

  identities() {
    return this._identities;
  },

  currentIdentity() {
    if (!this._currentIdentity) {
      throw new Error("CurrentIdentity must be set before calling Logic.currentIdentity.");
    }
    return this._currentIdentity;
  },

  currentUserContextId() {
    const identity = Logic.currentIdentity();
    return Utils.userContextId(identity.cookieStoreId);
  },

  currentCookieStoreId() {
    const identity = Logic.currentIdentity();
    return identity.cookieStoreId;
  },

  removeIdentity(userContextId) {
    if (!userContextId) {
      return Promise.reject("removeIdentity must be called with userContextId argument.");
    }

    return browser.runtime.sendMessage({
      method: "deleteContainer",
      message: { userContextId }
    });
  },

  getAssignment(tab) {
    return browser.runtime.sendMessage({
      method: "getAssignment",
      tabId: tab.id
    });
  },

  getAssignmentObjectByContainer(userContextId) {
    if (!userContextId) {
      return {};
    }
    return browser.runtime.sendMessage({
      method: "getAssignmentObjectByContainer",
      message: { userContextId }
    });
  },

  generateIdentityName() {
    const defaultName = "Container #";
    const ids = [];

    // This loop populates the 'ids' array with all the already-used ids.
    this._identities.forEach(identity => {
      if (identity.name.startsWith(defaultName)) {
        const id = parseInt(identity.name.substr(defaultName.length), 10);
        if (id) {
          ids.push(id);
        }
      }
    });

    // Here we find the first valid id.
    for (let id = 1; ; ++id) {
      if (ids.indexOf(id) === -1) {
        return defaultName + (id < 10 ? "0" : "") + id;
      }
    }
  },

  getCurrentPanelElement() {
    const panelItem = this._panels[this._currentPanel];
    return document.querySelector(this.getPanelSelector(panelItem));
  },

  listenToPickerBackButton() {
    const closeContEl = document.querySelector("#close-container-picker-panel");
    if (!this._listenerSet) {
      Utils.addEnterHandler(closeContEl, () => {
        Logic.showPreviousPanel();
      });
      this._listenerSet = true;
    }
  },

  shortcutListener(e){
    function openNewContainerTab(identity) {
      try {
        browser.tabs.create({
          cookieStoreId: identity.cookieStoreId
        });
        window.close();
      } catch (e) {
        window.close();
      }
    }
    const identities = Logic.identities();
    if ((e.keyCode >= 49 && e.keyCode <= 57) &&
            Logic._currentPanel === "containersList") {
      const identity = identities[e.keyCode - 49];
      if (identity) {
        openNewContainerTab(identity);
      }
    }
  },

  keyboardNavListener(e){
    const panelSelector = Logic.getPanelSelector(Logic._panels[Logic._currentPanel]);
    const selectables = [...document.querySelectorAll(`${panelSelector} .keyboard-nav[tabindex='0']`)];
    const element = document.activeElement;
    const backButton = document.querySelector(`${panelSelector} .keyboard-nav-back`);
    const index = selectables.indexOf(element) || 0;
    function next() {
      const nextElement = selectables[index + 1];
      if (nextElement) {
        nextElement.focus();
      }
    }
    function previous() {
      const previousElement = selectables[index - 1];
      if (previousElement) {
        previousElement.focus();
      }
    }
    switch (e.keyCode) {
    case 40:
      next();
      break;
    case 38:
      previous();
      break;
    case 39:
    {
      if(element){
        element.click();
      }

      // If one Container is highlighted,
      if (element.classList.contains("keyboard-right-arrow-override")) {
        element.querySelector(".menu-right-float").click();
      }

      break;
    }
    case 37:
    {
      if(backButton){
        backButton.click();
      }
      break;
    }
    default:
      break;
    }
  }
};

// P_ONBOARDING_1: First page for Onboarding.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_ONBOARDING_1, {
  panelSelector: ".onboarding-panel-1",
  securityPanelSelector: ".security-onboarding-panel-1",

  // This method is called when the object is registered.
  initialize() {
    // Let's move to the next panel.
    [...document.querySelectorAll(".onboarding-start-button")].forEach(startElement => {
      Utils.addEnterHandler(startElement, async () => {
        await Logic.setOnboardingStage(1);
        Logic.showPanel(P_ONBOARDING_2);
      });
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});

// P_ONBOARDING_2: Second page for Onboarding.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_ONBOARDING_2, {
  panelSelector: ".onboarding-panel-2",
  securityPanelSelector: ".security-onboarding-panel-2",

  // This method is called when the object is registered.
  initialize() {
    // Let's move to the containers list panel.
    [...document.querySelectorAll(".onboarding-next-button")].forEach(nextElement => {
      Utils.addEnterHandler(nextElement, async () => {
        await Logic.setOnboardingStage(2);
        Logic.showPanel(P_ONBOARDING_3);
      });
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});

// P_ONBOARDING_3: Third page for Onboarding.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_ONBOARDING_3, {
  panelSelector: ".onboarding-panel-3",
  securityPanelSelector: ".security-onboarding-panel-3",

  // This method is called when the object is registered.
  initialize() {
    // Let's move to the containers list panel.
    [...document.querySelectorAll(".onboarding-almost-done-button")].forEach(almostElement => {
      Utils.addEnterHandler(almostElement, async () => {
        await Logic.setOnboardingStage(3);
        Logic.showPanel(P_ONBOARDING_4);
      });
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});

// P_ONBOARDING_4: Fourth page for Onboarding.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_ONBOARDING_4, {
  panelSelector: ".onboarding-panel-4",

  // This method is called when the object is registered.
  initialize() {
    // Let's move to the containers list panel.
    Utils.addEnterHandler(document.querySelector("#onboarding-done-button"), async () => {
      await Logic.setOnboardingStage(4);
      Logic.showPanel(P_ONBOARDING_5);
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});

// P_ONBOARDING_5: Fifth page for Onboarding: new tab long-press behavior
// ----------------------------------------------------------------------------

Logic.registerPanel(P_ONBOARDING_5, {
  panelSelector: ".onboarding-panel-5",

  // This method is called when the object is registered.
  initialize() {
    // Let's move to the containers list panel.
    Utils.addEnterHandler(document.querySelector("#onboarding-longpress-button"), async () => {
      await Logic.setOnboardingStage(5);
      Logic.showPanel(P_ONBOARDING_6);
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});

// P_ONBOARDING_6: Sixth page for Onboarding: new tab long-press behavior
// ----------------------------------------------------------------------------

Logic.registerPanel(P_ONBOARDING_6, {
  panelSelector: ".onboarding-panel-6",

  // This method is called when the object is registered.
  initialize() {
    // Let's move to the containers list panel.
    Utils.addEnterHandler(document.querySelector("#start-sync-button"), async () => {
      await Logic.setOnboardingStage(6);
      await browser.storage.local.set({syncEnabled: true});
      await browser.runtime.sendMessage({
        method: "resetSync"
      });
      Logic.showPanel(P_ONBOARDING_7);
    });
    Utils.addEnterHandler(document.querySelector("#no-sync"), async () => {
      await Logic.setOnboardingStage(7);
      await browser.storage.local.set({syncEnabled: false});
      await browser.runtime.sendMessage({
        method: "resetSync"
      });
      Logic.showPanel(P_CONTAINERS_LIST);
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});

// P_ONBOARDING_6: Sixth page for Onboarding: new tab long-press behavior
// ----------------------------------------------------------------------------

Logic.registerPanel(P_ONBOARDING_7, {
  panelSelector: ".onboarding-panel-7",

  // This method is called when the object is registered.
  initialize() {
    // Let's move to the containers list panel.
    Utils.addEnterHandler(document.querySelector("#sign-in"), async () => {
      browser.tabs.create({
        url: "https://accounts.firefox.com/?service=sync&action=email&context=fx_desktop_v3&entrypoint=multi-account-containers&utm_source=addon&utm_medium=panel&utm_campaign=container-sync",
      });
      await Logic.setOnboardingStage(7);
      Logic.showPanel(P_CONTAINERS_LIST);
    });
    Utils.addEnterHandler(document.querySelector("#no-sign-in"), async () => {
      await Logic.setOnboardingStage(7);
      Logic.showPanel(P_CONTAINERS_LIST);
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});
// P_CONTAINERS_LIST: The list of containers. The main page.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINERS_LIST, {
  panelSelector: "#container-panel",

  // This method is called when the object is registered.
  async initialize() {
    Utils.addEnterHandler(document.querySelector("#manage-containers-link"), (e) => {
      if (!e.target.classList.contains("disable-edit-containers")) {
        Logic.showPanel(MANAGE_CONTAINERS_PICKER);
      }
    });
    Utils.addEnterHandler(document.querySelector("#open-new-tab-in"), () => {
      Logic.showPanel(OPEN_NEW_CONTAINER_PICKER);
    });
    Utils.addEnterHandler(document.querySelector("#reopen-site-in"), () => {
      Logic.showPanel(REOPEN_IN_CONTAINER_PICKER);
    });
    Utils.addEnterHandler(document.querySelector("#always-open-in"), () => {
      Logic.showPanel(ALWAYS_OPEN_IN_PICKER);
    });
    Utils.addEnterHandler(document.querySelector("#info-icon"), () => {
      browser.runtime.openOptionsPage();
    });
    Utils.addEnterHandler(document.querySelector("#sort-containers-link"), async () => {
      try {
        await browser.runtime.sendMessage({
          method: "sortTabs"
        });
        window.close();
      } catch (e) {
        window.close();
      }
    });

  },

  unregister() {
  },

  // This method is called when the panel is shown.
  async prepare() {
    const fragment = document.createDocumentFragment();

    Logic.identities().forEach(identity => {
      const tr = document.createElement("tr");
      tr.classList.add("menu-item", "hover-highlight", "keyboard-nav", "keyboard-right-arrow-override");
      tr.setAttribute("tabindex", "0");
      const td = document.createElement("td");
      const openTabs = identity.numberOfOpenTabs || "" ;

      td.innerHTML = Utils.escaped`
        <div class="menu-item-name">
          <div class="menu-icon">
            <div class="usercontext-icon"
              data-identity-icon="${identity.icon}"
              data-identity-color="${identity.color}">
            </div>
          </div>
          <span class="menu-text">${identity.name}</span>
        </div>
        <span class="menu-right-float">
          <span class="container-count">${openTabs}</span>
          <span class="menu-arrow">
            <img alt="Container Info" src="/img/arrow-icon-right.svg" />
          </span>
        </span>`;

      fragment.appendChild(tr);

      tr.appendChild(td);

      const openInThisContainer = tr.querySelector(".menu-item-name");
      Utils.addEnterHandler(openInThisContainer, () => {
        try {
          browser.tabs.create({
            cookieStoreId: identity.cookieStoreId
          });
          window.close();
        } catch (e) {
          window.close();
        }
      });

      Utils.addEnterOnlyHandler(tr, () => {
        try {
          browser.tabs.create({
            cookieStoreId: identity.cookieStoreId
          });
          window.close();
        } catch (e) {
          window.close();
        }
      });

      // Select only the ">" from the container list
      const showPanelButton = tr.querySelector(".menu-right-float");

      Utils.addEnterHandler(showPanelButton, () => {
        Logic.showPanel(P_CONTAINER_INFO, identity);
      });


    });

    const list = document.querySelector("#identities-list");

    list.innerHTML = "";
    list.appendChild(fragment);

    document.addEventListener("keydown", Logic.keyboardNavListener);
    document.addEventListener("keydown", Logic.shortcutListener);
    return Promise.resolve();
  },
});

// P_CONTAINER_INFO: More info about a container.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINER_INFO, {
  panelSelector: "#container-info-panel",

  // This method is called when the object is registered.
  async initialize() {
    const closeContEl = document.querySelector("#close-container-info-panel");
    Utils.addEnterHandler(closeContEl, () => {
      Logic.showPreviousPanel();
    });

    // Check if the user has incompatible add-ons installed
    // Note: this is not implemented in messageHandler.js
    let incompatible = false;
    try {
      incompatible = await browser.runtime.sendMessage({
        method: "checkIncompatibleAddons"
      });
    } catch (e) {
      throw new Error("Could not check for incompatible add-ons.");
    }

    const moveTabsEl = document.querySelector("#move-to-new-window");
    const numTabs = await Logic.numTabs();
    if (incompatible) {
      Logic._disableMenuItem("Moving container tabs is incompatible with Pulse, PageShot, and SnoozeTabs.");
      return;
    } else if (numTabs === 1) {
      Logic._disableMenuItem("Cannot move a tab from a single-tab window.");
      return;
    }

    Utils.addEnterHandler(moveTabsEl, async () => {
      await browser.runtime.sendMessage({
        method: "moveTabsToWindow",
        windowId: browser.windows.WINDOW_ID_CURRENT,
        cookieStoreId: Logic.currentIdentity().cookieStoreId,
      });
      window.close();
    });


  },

  // This method is called when the panel is shown.
  async prepare() {
    const identity = Logic.currentIdentity();

    const newTab = document.querySelector("#open-new-tab-in-info");
    Utils.addEnterHandler(newTab, () => {
      try {
        browser.tabs.create({
          cookieStoreId: identity.cookieStoreId
        });
        window.close();
      } catch (e) {
        window.close();
      }
    });
    // Populating the panel: name and icon
    document.getElementById("container-info-title").textContent = identity.name;

    const alwaysOpen = document.querySelector("#always-open-in-info-panel");
    Utils.addEnterHandler(alwaysOpen, async () => {
      Utils.alwaysOpenInContainer(identity);
      window.close();
    });
    // Show or not the has-tabs section.
    for (let trHasTabs of document.getElementsByClassName("container-info-has-tabs")) { // eslint-disable-line prefer-const
      trHasTabs.style.display = !identity.hasHiddenTabs && !identity.hasOpenTabs ? "none" : "";
    }

    if (identity.numberOfOpenTabs === 0) {
      Logic._disableMenuItem("No tabs available for this container");
    } else {
      Logic._enableMenuItems();
    }

    this.intializeShowHide(identity);

    // Let's retrieve the list of tabs.
    const tabs = await browser.runtime.sendMessage({
      method: "getTabs",
      windowId: browser.windows.WINDOW_ID_CURRENT,
      cookieStoreId: Logic.currentIdentity().cookieStoreId
    });
    const manageContainer = document.querySelector("#manage-container-link");
    Utils.addEnterHandler(manageContainer, async () => {
      Logic.showPanel(P_CONTAINER_EDIT, identity);
    });
    return this.buildOpenTabTable(tabs);
  },

  intializeShowHide(identity) {
    const hideContEl = document.querySelector("#hideorshow-container");
    if (identity.numberOfOpenTabs === 0 && !identity.hasHiddenTabs) {
      return Logic._disableMenuItem("No tabs available for this container",  hideContEl);
    } else {
      Logic._enableMenuItems(hideContEl);
    }

    Utils.addEnterHandler(hideContEl, async () => {
      try {
        browser.runtime.sendMessage({
          method: identity.hasHiddenTabs ? "showTabs" : "hideTabs",
          windowId: browser.windows.WINDOW_ID_CURRENT,
          cookieStoreId: Logic.currentCookieStoreId()
        });
        window.close();
      } catch (e) {
        window.close();
      }
    });

    const hideShowIcon = document.getElementById("container-info-hideorshow-icon");
    hideShowIcon.src = identity.hasHiddenTabs ? CONTAINER_UNHIDE_SRC : CONTAINER_HIDE_SRC;

    const hideShowLabel = document.getElementById("container-info-hideorshow-label");
    hideShowLabel.textContent = identity.hasHiddenTabs ? "Show this container" : "Hide this container";
    return;
  },

  buildOpenTabTable(tabs) {
    // Let's remove all the previous tabs.
    const table = document.getElementById("container-info-table");
    while (table.firstChild) {
      table.firstChild.remove();
    }

    // For each one, let's create a new line.
    const fragment = document.createDocumentFragment();
    for (let tab of tabs) { // eslint-disable-line prefer-const
      const tr = document.createElement("tr");
      fragment.appendChild(tr);
      tr.classList.add("menu-item", "hover-highlight", "keyboard-nav");
      tr.setAttribute("tabindex", "0");
      tr.innerHTML = Utils.escaped`
        <td>
          <div class="favicon"></div>
          <span title="${tab.url}" class="menu-text truncate-text">${tab.title}</span>
          <img id="${tab.id}" class="trash-button" src="/img/container-close-tab.svg" />
        </td>`;
      tr.querySelector(".favicon").appendChild(Utils.createFavIconElement(tab.favIconUrl));
      tr.setAttribute("tabindex", "0");
      table.appendChild(fragment);

      // On click, we activate this tab. But only if this tab is active.
      if (!tab.hiddenState) {
        Utils.addEnterHandler(tr, async () => {
          await browser.tabs.update(tab.id, { active: true });
          window.close();
        });

        const closeTab = tr.querySelector(".trash-button");
        if (closeTab) {
          Utils.addEnterHandler(closeTab, async (e) => {
            await browser.tabs.remove(Number(e.target.id));
            window.close();
          });
        }
      }
    }
  },
});

// OPEN_NEW_CONTAINER_PICKER: Opens a new container tab.
// ----------------------------------------------------------------------------

Logic.registerPanel(OPEN_NEW_CONTAINER_PICKER, {
  panelSelector: "#container-picker-panel",

  // This method is called when the object is registered.
  initialize() {
  },

  // This method is called when the panel is shown.
  prepare() {
    Logic.listenToPickerBackButton();
    document.getElementById("picker-title").textContent = "Open a New Tab in";
    const fragment = document.createDocumentFragment();
    const pickedFunction = function (identity) {
      try {
        browser.tabs.create({
          cookieStoreId: identity.cookieStoreId
        });
        window.close();
      } catch (e) {
        window.close();
      }
    };

    document.getElementById("new-container-div").innerHTML = "";

    Logic.identities().forEach(identity => {
      const tr = document.createElement("tr");
      tr.classList.add("menu-item", "hover-highlight", "keyboard-nav");
      tr.setAttribute("tabindex", "0");
      const td = document.createElement("td");

      td.innerHTML = Utils.escaped`
        <div class="menu-icon">
          <div class="usercontext-icon"
            data-identity-icon="${identity.icon}"
            data-identity-color="${identity.color}">
          </div>
        </div>
        <span class="menu-text">${identity.name}</span>`;

      fragment.appendChild(tr);

      tr.appendChild(td);

      Utils.addEnterHandler(tr, () => {
        pickedFunction(identity);
      });
    });

    const list = document.querySelector("#picker-identities-list");

    list.innerHTML = "";
    list.appendChild(fragment);

    return Promise.resolve(null);
  }
});

// MANAGE_CONTAINERS_PICKER: Makes the list editable.
// ----------------------------------------------------------------------------

Logic.registerPanel(MANAGE_CONTAINERS_PICKER, {
  panelSelector: "#container-picker-panel",

  // This method is called when the object is registered.
  initialize() {
  },

  // This method is called when the panel is shown.
  prepare() {
    Logic.listenToPickerBackButton();
    const closeContEl = document.querySelector("#close-container-picker-panel");
    if (!this._listenerSet) {
      Utils.addEnterHandler(closeContEl, () => {
        Logic.showPreviousPanel();
      });
      this._listenerSet = true;
    }
    document.getElementById("picker-title").textContent = "Manage Containers";
    const fragment = document.createDocumentFragment();
    const pickedFunction = function (identity) {
      Logic.showPanel(P_CONTAINER_EDIT, identity);
    };

    document.getElementById("new-container-div").innerHTML = Utils.escaped`
      <table class="menu">
        <tr class="menu-item hover-highlight keyboard-nav" id="new-container" tabindex="0">
          <td>
            <div class="menu-icon"><img alt="New Container" src="/img/new-16.svg" />
            </div>
            <span class="menu-text">New Container</span>
          </td>
        </tr>
      </table>
      <hr>
    `;

    Utils.addEnterHandler(document.querySelector("#new-container"), () => {
      Logic.showPanel(P_CONTAINER_EDIT, { name: Logic.generateIdentityName() });
    });

    Logic.identities().forEach(identity => {
      const tr = document.createElement("tr");
      tr.classList.add("menu-item", "hover-highlight", "keyboard-nav");
      tr.setAttribute("tabindex", "0");
      const td = document.createElement("td");

      td.innerHTML = Utils.escaped`
        <div class="menu-icon hover-highlight">
          <div class="usercontext-icon"
            data-identity-icon="${identity.icon}"
            data-identity-color="${identity.color}">
          </div>
        </div>
        <span class="menu-text">${identity.name}</span>
        <span class="move-button">
          <img
            class="pop-button-image"
            src="/img/container-move.svg"
          />
        </span>`;

      fragment.appendChild(tr);

      tr.appendChild(td);

      tr.draggable = true;
      tr.dataset.containerId = identity.cookieStoreId;
      tr.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(CONTAINER_DRAG_DATA_TYPE, identity.cookieStoreId);
      });
      tr.addEventListener("dragover", (e) => {
        if (e.dataTransfer.types.includes(CONTAINER_DRAG_DATA_TYPE)) {
          tr.classList.add("drag-over");
          e.preventDefault();
        }
      });
      tr.addEventListener("dragenter", (e) => {
        if (e.dataTransfer.types.includes(CONTAINER_DRAG_DATA_TYPE)) {
          e.preventDefault();
          tr.classList.add("drag-over");
        }
      });
      tr.addEventListener("dragleave", (e) => {
        if (e.dataTransfer.types.includes(CONTAINER_DRAG_DATA_TYPE)) {
          e.preventDefault();
          tr.classList.remove("drag-over");
        }
      });
      tr.addEventListener("drop", async (e) => {
        e.preventDefault();
        const parent = tr.parentNode;
        const containerId = e.dataTransfer.getData(CONTAINER_DRAG_DATA_TYPE);
        let droppedElement;
        parent.childNodes.forEach((node) => {
          if (node.dataset.containerId === containerId) {
            droppedElement = node;
          }
        });
        if (droppedElement && droppedElement !== tr) {
          tr.classList.remove("drag-over");
          parent.insertBefore(droppedElement, tr);
          await Logic.saveContainerOrder(parent.childNodes);
          await Logic.refreshIdentities();
        }
      });

      Utils.addEnterHandler(tr, () => {
        pickedFunction(identity);
      });
    });

    const list = document.querySelector("#picker-identities-list");

    list.innerHTML = "";
    list.appendChild(fragment);

    return Promise.resolve(null);
  }
});

// REOPEN_IN_CONTAINER_PICKER: Makes the list editable.
// ----------------------------------------------------------------------------

Logic.registerPanel(REOPEN_IN_CONTAINER_PICKER, {
  panelSelector: "#container-picker-panel",

  // This method is called when the object is registered.
  initialize() {
  },

  // This method is called when the panel is shown.
  async prepare() {
    Logic.listenToPickerBackButton();
    document.getElementById("picker-title").textContent = "Reopen This Site in";
    const fragment = document.createDocumentFragment();
    const currentTab = await Utils.currentTab();
    const pickedFunction = function (identity) {
      const newUserContextId = Utils.userContextId(identity.cookieStoreId);
      Utils.reloadInContainer(
        currentTab.url,
        false,
        newUserContextId,
        currentTab.index + 1,
        currentTab.active
      );
      window.close();
    };

    document.getElementById("new-container-div").innerHTML = "";

    if (currentTab.cookieStoreId !== "firefox-default") {
      const tr = document.createElement("tr");
      tr.classList.add("menu-item", "hover-highlight", "keyboard-nav");
      const td = document.createElement("td");

      td.innerHTML = Utils.escaped`
        <div class="menu-icon hover-highlight">
          <div class="mac-icon">
          </div>
        </div>
        <span class="menu-text">Default Container</span>`;

      fragment.appendChild(tr);

      tr.appendChild(td);

      Utils.addEnterHandler(tr, () => {
        Utils.reloadInContainer(
          currentTab.url,
          false,
          0,
          currentTab.index + 1,
          currentTab.active
        );
        window.close();
      });
    }

    Logic.identities().forEach(identity => {
      if (currentTab.cookieStoreId !== identity.cookieStoreId) {
        const tr = document.createElement("tr");
        tr.classList.add("menu-item", "hover-highlight", "keyboard-nav");
        tr.setAttribute("tabindex", "0");
        const td = document.createElement("td");

        td.innerHTML = Utils.escaped`
        <div class="menu-icon hover-highlight">
          <div class="usercontext-icon"
            data-identity-icon="${identity.icon}"
            data-identity-color="${identity.color}">
          </div>
        </div>
        <span class="menu-text">${identity.name}</span>`;

        fragment.appendChild(tr);

        tr.appendChild(td);

        Utils.addEnterHandler(tr, () => {
          pickedFunction(identity);
        });
      }
    });

    const list = document.querySelector("#picker-identities-list");

    list.innerHTML = "";
    list.appendChild(fragment);

    return Promise.resolve(null);
  }
});

// ALWAYS_OPEN_IN_PICKER: Makes the list editable.
// ----------------------------------------------------------------------------

Logic.registerPanel(ALWAYS_OPEN_IN_PICKER, {
  panelSelector: "#container-picker-panel",

  // This method is called when the object is registered.
  initialize() {
  },

  // This method is called when the panel is shown.
  prepare() {
    Logic.listenToPickerBackButton();
    document.getElementById("picker-title").textContent = "Always Open in";
    const fragment = document.createDocumentFragment();

    document.getElementById("new-container-div").innerHTML = "";

    Logic.identities().forEach(identity => {
      const tr = document.createElement("tr");
      tr.classList.add("menu-item", "hover-highlight", "keyboard-nav");
      tr.setAttribute("tabindex", "0");
      const td = document.createElement("td");

      td.innerHTML = Utils.escaped`
        <div class="menu-icon hover-highlight">
          <div class="usercontext-icon"
            data-identity-icon="${identity.icon}"
            data-identity-color="${identity.color}">
          </div>
        </div>
        <span class="menu-text">${identity.name}</span>`;

      fragment.appendChild(tr);

      tr.appendChild(td);

      Utils.addEnterHandler(tr, () => {
        Utils.alwaysOpenInContainer(identity);
        window.close();
      });
    });

    const list = document.querySelector("#picker-identities-list");

    list.innerHTML = "";
    list.appendChild(fragment);

    return Promise.resolve(null);
  }
});

// P_CONTAINER_ASSIGNMENTS: Shows Site Assignments and allows editing.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINER_ASSIGNMENTS, {
  panelSelector: "#edit-container-assignments",

  // This method is called when the object is registered.
  initialize() {
    const closeContEl = document.querySelector("#close-container-assignment-panel");
    Utils.addEnterHandler(closeContEl, () => {
      Logic.showPreviousPanel();
    });
  },

  // This method is called when the panel is shown.
  async prepare() {
    const identity = Logic.currentIdentity();

    // Populating the panel: name and icon
    document.getElementById("edit-assignments-title").textContent = identity.name;

    const userContextId = Logic.currentUserContextId();
    const assignments = await Logic.getAssignmentObjectByContainer(userContextId);
    this.showAssignedContainers(assignments);

    return Promise.resolve(null);
  },

  showAssignedContainers(assignments) {
    const assignmentPanel = document.getElementById("edit-sites-assigned");
    const assignmentKeys = Object.keys(assignments);
    assignmentPanel.hidden = !(assignmentKeys.length > 0);
    if (assignments) {
      const tableElement = document.querySelector("#edit-sites-assigned");
      /* Remove previous assignment list,
         after removing one we rerender the list */
      while (tableElement.firstChild) {
        tableElement.firstChild.remove();
      }
      assignmentKeys.forEach((siteKey) => {
        const site = assignments[siteKey];
        const trElement = document.createElement("tr");
        /* As we don't have the full or correct path the best we can assume is the path is HTTPS and then replace with a broken icon later if it doesn't load.
           This is pending a better solution for favicons from web extensions */
        const assumedUrl = `https://${site.hostname}/favicon.ico`;
        trElement.innerHTML = Utils.escaped`
        <td>
          <div class="favicon"></div>
          <span title="${site.hostname}" class="menu-text">${site.hostname}</span>
          <img class="trash-button delete-assignment" src="/img/container-delete.svg" />
        </td>`;
        trElement.getElementsByClassName("favicon")[0].appendChild(Utils.createFavIconElement(assumedUrl));
        const deleteButton = trElement.querySelector(".trash-button");
        Utils.addEnterHandler(deleteButton, async () => {
          const userContextId = Logic.currentUserContextId();
          // Lets show the message to the current tab
          // const currentTab = await Utils.currentTab();
          Utils.setOrRemoveAssignment(false, assumedUrl, userContextId, true);
          delete assignments[siteKey];
          this.showAssignedContainers(assignments);
        });
        trElement.classList.add("menu-item", "hover-highlight", "keyboard-nav");
        tableElement.appendChild(trElement);
      });
    }
  },
});

// P_CONTAINER_EDIT: Editor for a container.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINER_EDIT, {
  panelSelector: "#edit-container-panel",

  // This method is called when the object is registered.
  initialize() {
    this.initializeRadioButtons();
    Utils.addEnterHandler(document.querySelector("#close-container-edit-panel"), () => {
      // Resets listener from siteIsolation checkbox to keep the update queue to 0.
      const siteIsolation = document.querySelector("#site-isolation");
      siteIsolation.removeEventListener("change", addRemoveSiteIsolation, false);
      const formValues = new FormData(this._editForm);
      if (formValues.get("container-id") !== NEW_CONTAINER_ID) {
        this._submitForm();
      } else {
        Logic.showPreviousPanel();
      }
    });

    this._editForm = document.getElementById("edit-container-panel-form");
    this._editForm.addEventListener("submit", () => {
      this._submitForm();
    });
    Utils.addEnterHandler(document.querySelector("#create-container-cancel-link"), () => {
      Logic.showPreviousPanel();
    });

    Utils.addEnterHandler(document.querySelector("#create-container-ok-link"), () => {
      this._submitForm();
    });
  },

  async _submitForm() {
    const formValues = new FormData(this._editForm);
    try {
      await browser.runtime.sendMessage({
        method: "createOrUpdateContainer",
        message: {
          userContextId: formValues.get("container-id") || NEW_CONTAINER_ID,
          params: {
            name: document.getElementById("edit-container-panel-name-input").value || Logic.generateIdentityName(),
            icon: formValues.get("container-icon") || DEFAULT_ICON,
            color: formValues.get("container-color") || DEFAULT_COLOR,
          }
        }
      });
      await Logic.refreshIdentities();
      Logic.showPreviousPanel();
    } catch (e) {
      Logic.showPanel(P_CONTAINERS_LIST);
    }
  },

  initializeRadioButtons() {
    const colorRadioTemplate = (containerColor) => {
      return Utils.escaped`<input type="radio" value="${containerColor}" name="container-color" id="edit-container-panel-choose-color-${containerColor}" />
     <label for="edit-container-panel-choose-color-${containerColor}" class="usercontext-icon choose-color-icon" data-identity-icon="circle" data-identity-color="${containerColor}">`;
    };
    const colors = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
    const colorRadioFieldset = document.getElementById("edit-container-panel-choose-color");
    colors.forEach((containerColor) => {
      const templateInstance = document.createElement("div");
      templateInstance.classList.add("radio-container");
      // eslint-disable-next-line no-unsanitized/property
      templateInstance.innerHTML = colorRadioTemplate(containerColor);
      colorRadioFieldset.appendChild(templateInstance);
    });

    const iconRadioTemplate = (containerIcon) => {
      return Utils.escaped`<input type="radio" value="${containerIcon}" name="container-icon" id="edit-container-panel-choose-icon-${containerIcon}" />
     <label for="edit-container-panel-choose-icon-${containerIcon}" class="usercontext-icon choose-color-icon" data-identity-color="grey" data-identity-icon="${containerIcon}">`;
    };
    const icons = ["fingerprint", "briefcase", "dollar", "cart", "vacation", "gift", "food", "fruit", "pet", "tree", "chill", "circle", "fence"];
    const iconRadioFieldset = document.getElementById("edit-container-panel-choose-icon");
    icons.forEach((containerIcon) => {
      const templateInstance = document.createElement("div");
      templateInstance.classList.add("radio-container");
      // eslint-disable-next-line no-unsanitized/property
      templateInstance.innerHTML = iconRadioTemplate(containerIcon);
      iconRadioFieldset.appendChild(templateInstance);
    });
  },

  // This method is called when the panel is shown.
  async prepare() {
    const identity = Logic.currentIdentity();

    // Populating the panel: name and icon
    document.getElementById("container-edit-title").textContent = identity.name;

    const userContextId = Logic.currentUserContextId();
    document.querySelector("#edit-container-panel .panel-footer").hidden = !!userContextId;
    document.querySelector("#edit-container-panel .delete-container").hidden = !userContextId;
    document.querySelector("#edit-container-options").hidden = !userContextId;

    Utils.addEnterHandler(document.querySelector("#manage-assigned-sites-list"), () => {
      Logic.showPanel(P_CONTAINER_ASSIGNMENTS, identity);
    });

    document.querySelector("#edit-container-panel-name-input").value = identity.name || "";
    document.querySelector("#edit-container-panel-usercontext-input").value = userContextId || NEW_CONTAINER_ID;
    const containerName = document.querySelector("#edit-container-panel-name-input");
    window.requestAnimationFrame(() => {
      containerName.select();
      containerName.focus();
    });

    const siteIsolation = document.querySelector("#site-isolation");
    siteIsolation.checked = !!identity.isIsolated;
    siteIsolation.addEventListener( "change", addRemoveSiteIsolation, false);
    [...document.querySelectorAll("[name='container-color']")].forEach(colorInput => {
      colorInput.checked = colorInput.value === identity.color;
    });
    [...document.querySelectorAll("[name='container-icon']")].forEach(iconInput => {
      iconInput.checked = iconInput.value === identity.icon;
    });

    const deleteButton = document.getElementById("delete-container-button");
    Utils.addEnterHandler(deleteButton, () => {
      Logic.showPanel(P_CONTAINER_DELETE, identity);
    });
    return Promise.resolve(null);
  },

});

// P_CONTAINER_DELETE: Delete a container.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINER_DELETE, {
  panelSelector: "#delete-container-panel",

  // This method is called when the object is registered.
  initialize() {
    Utils.addEnterHandler(document.querySelector("#delete-container-cancel-link"), () => {
      Logic.showPreviousPanel();
    });
    Utils.addEnterHandler(document.querySelector("#close-container-delete-panel"), () => {
      Logic.showPreviousPanel();
    });
    Utils.addEnterHandler(document.querySelector("#delete-container-ok-link"), async () => {
      /* This promise wont resolve if the last tab was removed from the window.
          as the message async callback stops listening, this isn't an issue for us however it might be in future
          if you want to do anything post delete do it in the background script.
          Browser console currently warns about not listening also.
      */
      try {
        await Logic.removeIdentity(Utils.userContextId(Logic.currentIdentity().cookieStoreId));
        await Logic.refreshIdentities();
        Logic.showPanel(P_CONTAINERS_LIST);
      } catch (e) {
        Logic.showPanel(P_CONTAINERS_LIST);
      }
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    const identity = Logic.currentIdentity();

    // Populating the panel: name, icon, and warning message
    document.getElementById("container-delete-title").textContent = identity.name;

    const totalNumberOfTabs = identity.numberOfHiddenTabs + identity.numberOfOpenTabs;
    let warningMessage = "";
    if (totalNumberOfTabs > 0) {
      const grammaticalNumTabs = totalNumberOfTabs > 1 ? "tabs" : "tab";
      warningMessage = `If you remove this container now, ${totalNumberOfTabs} container ${grammaticalNumTabs} will be closed.`;
    }
    document.getElementById("delete-container-tab-warning").textContent = warningMessage;

    return Promise.resolve(null);
  },
});

// P_CONTAINERS_ACHIEVEMENT: Page for achievement.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINERS_ACHIEVEMENT, {
  panelSelector: ".achievement-panel",

  // This method is called when the object is registered.
  initialize() {
    // Set done and move to the containers list panel.
    Utils.addEnterHandler(document.querySelector("#achievement-done-button"), async () => {
      await Logic.setAchievementDone("manyContainersOpened");
      Logic.showPanel(P_CONTAINERS_LIST);
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    return Promise.resolve(null);
  },
});

Logic.init();

window.addEventListener("resize", function () {
  //for overflow menu
  const difference = window.innerWidth - document.body.offsetWidth;
  if (difference > 2) {
    //if popup is in the overflow menu, window will be larger than 300px
    const root = document.documentElement;
    root.style.setProperty("--overflow-size", difference + "px");
    root.style.setProperty("--icon-fit", "12");
  }
});
