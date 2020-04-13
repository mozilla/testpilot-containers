/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const CONTAINER_HIDE_SRC = "/img/container-hide.svg";
const CONTAINER_UNHIDE_SRC = "/img/container-unhide.svg";

const DEFAULT_COLOR = "blue";
const DEFAULT_ICON = "circle";
const NEW_CONTAINER_ID = "new";

const ONBOARDING_STORAGE_KEY = "onboarding-stage";

// List of panels
const P_ONBOARDING_1 = "onboarding1";
const P_ONBOARDING_2 = "onboarding2";
const P_ONBOARDING_3 = "onboarding3";
const P_ONBOARDING_4 = "onboarding4";
const P_ONBOARDING_5 = "onboarding5";
const P_ONBOARDING_6 = "onboarding6";
const P_ONBOARDING_7 = "onboarding7";
const P_CONTAINERS_LIST = "containersList";
const P_CONTAINERS_EDIT = "containersEdit";
const P_CONTAINER_INFO = "containerInfo";
const P_CONTAINER_EDIT = "containerEdit";
const P_CONTAINER_DELETE = "containerDelete";
const P_CONTAINERS_ACHIEVEMENT = "containersAchievement";

/**
 * Escapes any occurances of &, ", <, > or / with XML entities.
 *
 * @param {string} str
 *        The string to escape.
 * @return {string} The escaped string.
 */
function escapeXML(str) {
  const replacements = { "&": "&amp;", "\"": "&quot;", "'": "&apos;", "<": "&lt;", ">": "&gt;", "/": "&#x2F;" };
  return String(str).replace(/[&"'<>/]/g, m => replacements[m]);
}

/**
 * A tagged template function which escapes any XML metacharacters in
 * interpolated values.
 *
 * @param {Array<string>} strings
 *        An array of literal strings extracted from the templates.
 * @param {Array} values
 *        An array of interpolated values extracted from the template.
 * @returns {string}
 *        The result of the escaped values interpolated with the literal
 *        strings.
 */
function escaped(strings, ...values) {
  const result = [];

  for (const [i, string] of strings.entries()) {
    result.push(string);
    if (i < values.length)
      result.push(escapeXML(values[i]));
  }

  return result.join("");
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
  _previousPanel: null,
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

  addEnterHandler(element, handler) {
    element.addEventListener("click", (e) => {
      handler(e);
    });
    element.addEventListener("keydown", (e) => {
      if (e.keyCode === 13) {
        e.preventDefault();
        handler(e);
      }
    });
  },

  userContextId(cookieStoreId = "") {
    const userContextId = cookieStoreId.replace("firefox-container-", "");
    return (userContextId !== cookieStoreId) ? Number(userContextId) : false;
  },

  async currentTab() {
    const activeTabs = await browser.tabs.query({ active: true, windowId: browser.windows.WINDOW_ID_CURRENT });
    if (activeTabs.length > 0) {
      return activeTabs[0];
    }
    return false;
  },

  async numTabs() {
    const activeTabs = await browser.tabs.query({ windowId: browser.windows.WINDOW_ID_CURRENT });
    return activeTabs.length;
  },

  _disableMoveTabs(message) {
    const moveTabsEl = document.querySelector("#container-info-movetabs");
    const fragment = document.createDocumentFragment();
    const incompatEl = document.createElement("div");

    moveTabsEl.classList.remove("clickable");
    moveTabsEl.setAttribute("title", message);

    fragment.appendChild(incompatEl);
    incompatEl.setAttribute("id", "container-info-movetabs-incompat");
    incompatEl.textContent = message;
    incompatEl.classList.add("container-info-tab-row");

    moveTabsEl.parentNode.insertBefore(fragment, moveTabsEl.nextSibling);
  },

  async refreshIdentities() {
    const [identities, state] = await Promise.all([
      browser.contextualIdentities.query({}),
      browser.runtime.sendMessage({
        method: "queryIdentitiesState",
        message: {
          windowId: browser.windows.WINDOW_ID_CURRENT
        }
      })
    ]);
    this._identities = identities.map((identity) => {
      const stateObject = state[identity.cookieStoreId];
      if (stateObject) {
        identity.hasOpenTabs = stateObject.hasOpenTabs;
        identity.hasHiddenTabs = stateObject.hasHiddenTabs;
        identity.numberOfHiddenTabs = stateObject.numberOfHiddenTabs;
        identity.numberOfOpenTabs = stateObject.numberOfOpenTabs;
      }
      return identity;
    });
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

  async showPanel(panel, currentIdentity = null) {
    // Invalid panel... ?!?
    if (!(panel in this._panels)) {
      throw new Error("Something really bad happened. Unknown panel: " + panel);
    }

    this._previousPanel = this._currentPanel;
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
    if (!this._previousPanel) {
      throw new Error("Current panel not set!");
    }

    this.showPanel(this._previousPanel, this._currentIdentity);
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
    return Logic.userContextId(identity.cookieStoreId);
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

  setOrRemoveAssignment(tabId, url, userContextId, value) {
    return browser.runtime.sendMessage({
      method: "setOrRemoveAssignment",
      tabId,
      url,
      userContextId,
      value
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
      Logic.addEnterHandler(startElement, async () => {
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
      Logic.addEnterHandler(nextElement, async () => {
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
      Logic.addEnterHandler(almostElement, async () => {
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
    Logic.addEnterHandler(document.querySelector("#onboarding-done-button"), async () => {
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
    Logic.addEnterHandler(document.querySelector("#onboarding-longpress-button"), async () => {
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
    Logic.addEnterHandler(document.querySelector("#start-sync-button"), async () => {
      await Logic.setOnboardingStage(6);
      await browser.storage.local.set({syncEnabled: true});
      await browser.runtime.sendMessage({
        method: "resetSync"
      });
      Logic.showPanel(P_ONBOARDING_7);
    });
    Logic.addEnterHandler(document.querySelector("#no-sync"), async () => {
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
    Logic.addEnterHandler(document.querySelector("#sign-in"), async () => {
      browser.tabs.create({
        url: "https://accounts.firefox.com/?service=sync&action=email&context=fx_desktop_v3&entrypoint=multi-account-containers&utm_source=addon&utm_medium=panel&utm_campaign=container-sync",
      });
      await Logic.setOnboardingStage(7);
      Logic.showPanel(P_CONTAINERS_LIST);
    });
    Logic.addEnterHandler(document.querySelector("#no-sign-in"), async () => {
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
    Logic.addEnterHandler(document.querySelector("#container-add-link"), () => {
      Logic.showPanel(P_CONTAINER_EDIT, { name: Logic.generateIdentityName() });
    });

    Logic.addEnterHandler(document.querySelector("#edit-containers-link"), (e) => {
      if (!e.target.classList.contains("disable-edit-containers")) {
        Logic.showPanel(P_CONTAINERS_EDIT);
      }
    });

    Logic.addEnterHandler(document.querySelector("#sort-containers-link"), async () => {
      try {
        await browser.runtime.sendMessage({
          method: "sortTabs"
        });
        window.close();
      } catch (e) {
        window.close();
      }
    });

    document.addEventListener("keydown", (e) => {
      const selectables = [...document.querySelectorAll(".open-newtab[tabindex='0']")];
      const element = document.activeElement;
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
        const showTabs = element.parentNode.querySelector(".show-tabs");
        if(showTabs) {
          showTabs.click();
        }
        break;
      }
      case 37:
      {
        const hideTabs = document.querySelector(".panel-back-arrow");
        if(hideTabs) {
          hideTabs.click();
        }
        break;
      }
      default:
        if ((e.keyCode >= 49 && e.keyCode <= 57) &&
            Logic._currentPanel === "containersList") {
          const element = selectables[e.keyCode - 49];
          if (element) {
            element.click();
          }
        }
        break;
      }
    });

    // When the popup is open sometimes the tab will still be updating it's state
    this.tabUpdateHandler = (tabId, changeInfo) => {
      const propertiesToUpdate = ["title", "favIconUrl"];
      const hasChanged = Object.keys(changeInfo).find((changeInfoKey) => {
        if (propertiesToUpdate.includes(changeInfoKey)) {
          return true;
        }
      });
      if (hasChanged) {
        this.prepareCurrentTabHeader();
      }
    };
    browser.tabs.onUpdated.addListener(this.tabUpdateHandler);
  },

  unregister() {
    browser.tabs.onUpdated.removeListener(this.tabUpdateHandler);
  },

  setupAssignmentCheckbox(siteSettings, currentUserContextId) {
    const assignmentCheckboxElement = document.getElementById("container-page-assigned");
    let checked = false;
    if (siteSettings && Number(siteSettings.userContextId) === currentUserContextId) {
      checked = true;
    }
    assignmentCheckboxElement.checked = checked;
    let disabled = false;
    if (siteSettings === false) {
      disabled = true;
    }
    assignmentCheckboxElement.disabled = disabled;
  },

  async prepareCurrentTabHeader() {
    const currentTab = await Logic.currentTab();
    const currentTabElement = document.getElementById("current-tab");
    const assignmentCheckboxElement = document.getElementById("container-page-assigned");
    const currentTabUserContextId = Logic.userContextId(currentTab.cookieStoreId);
    assignmentCheckboxElement.addEventListener("change", () => {
      Logic.setOrRemoveAssignment(currentTab.id, currentTab.url, currentTabUserContextId, !assignmentCheckboxElement.checked);
    });
    currentTabElement.hidden = !currentTab;
    this.setupAssignmentCheckbox(false, currentTabUserContextId);
    if (currentTab) {
      const identity = await Logic.identity(currentTab.cookieStoreId);
      const siteSettings = await Logic.getAssignment(currentTab);
      this.setupAssignmentCheckbox(siteSettings, currentTabUserContextId);
      const currentPage = document.getElementById("current-page");
      currentPage.innerHTML = escaped`<span class="page-title truncate-text">${currentTab.title}</span>`;
      const favIconElement = Utils.createFavIconElement(currentTab.favIconUrl || "");
      currentPage.prepend(favIconElement);

      const currentContainer = document.getElementById("current-container");
      currentContainer.innerText = identity.name;

      currentContainer.setAttribute("data-identity-color", identity.color);
    }
  },

  // This method is called when the panel is shown.
  async prepare() {
    const fragment = document.createDocumentFragment();

    this.prepareCurrentTabHeader();

    Logic.identities().forEach(identity => {
      const hasTabs = (identity.hasHiddenTabs || identity.hasOpenTabs);
      const tr = document.createElement("tr");
      const context = document.createElement("td");
      const manage = document.createElement("td");

      tr.classList.add("container-panel-row");

      context.classList.add("userContext-wrapper", "open-newtab", "clickable", "firstTabindex");
      manage.classList.add("show-tabs", "pop-button");
      manage.setAttribute("title", `View ${identity.name} container`);
      context.setAttribute("tabindex", "0");
      context.setAttribute("title", `Create ${identity.name} tab`);
      context.innerHTML = escaped`
        <div class="userContext-icon-wrapper open-newtab">
          <div class="usercontext-icon"
            data-identity-icon="${identity.icon}"
            data-identity-color="${identity.color}">
          </div>
        </div>
        <div class="container-name truncate-text"></div>`;
      context.querySelector(".container-name").textContent = identity.name;
      manage.innerHTML = "<img src='/img/container-arrow.svg' class='show-tabs pop-button-image-small' />";

      fragment.appendChild(tr);

      tr.appendChild(context);

      if (hasTabs) {
        tr.appendChild(manage);
      }

      Logic.addEnterHandler(tr, async (e) => {
        if (e.target.matches(".open-newtab")
          || e.target.parentNode.matches(".open-newtab")
          || e.type === "keydown") {
          try {
            browser.tabs.create({
              cookieStoreId: identity.cookieStoreId
            });
            window.close();
          } catch (e) {
            window.close();
          }
        } else if (hasTabs) {
          Logic.showPanel(P_CONTAINER_INFO, identity);
        }
      });
    });

    const list = document.querySelector(".identities-list tbody");

    list.innerHTML = "";
    list.appendChild(fragment);
    /* Not sure why extensions require a focus for the doorhanger,
       however it allows us to have a tabindex before the first selected item
     */
    const focusHandler = () => {
      const identityList = list.querySelector("tr .clickable");
      if (identityList) {
        // otherwise this throws an error when there are no containers present.
        identityList.focus();
        document.removeEventListener("focus", focusHandler);
      }
    };
    document.addEventListener("focus", focusHandler);
    /* If the user mousedown's first then remove the focus handler */
    document.addEventListener("mousedown", () => {
      document.removeEventListener("focus", focusHandler);
    });
    /*  If no container is present disable the Edit Containers button */
    const editContainer = document.querySelector("#edit-containers-link");
    if (Logic.identities().length === 0) {
      editContainer.classList.add("disable-edit-containers");
    } else {
      editContainer.classList.remove("disable-edit-containers");
    }

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
    closeContEl.setAttribute("tabindex", "0");
    closeContEl.classList.add("firstTabindex");
    Logic.addEnterHandler(closeContEl, () => {
      Logic.showPreviousPanel();
    });
    const hideContEl = document.querySelector("#container-info-hideorshow");
    hideContEl.setAttribute("tabindex", "0");
    Logic.addEnterHandler(hideContEl, async () => {
      const identity = Logic.currentIdentity();
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

    // Check if the user has incompatible add-ons installed
    let incompatible = false;
    try {
      incompatible = await browser.runtime.sendMessage({
        method: "checkIncompatibleAddons"
      });
    } catch (e) {
      throw new Error("Could not check for incompatible add-ons.");
    }
    const moveTabsEl = document.querySelector("#container-info-movetabs");
    moveTabsEl.setAttribute("tabindex","0");
    const numTabs = await Logic.numTabs();
    if (incompatible) {
      Logic._disableMoveTabs("Moving container tabs is incompatible with Pulse, PageShot, and SnoozeTabs.");
      return;
    } else if (numTabs === 1) {
      Logic._disableMoveTabs("Cannot move a tab from a single-tab window.");
      return;
    }
    Logic.addEnterHandler(moveTabsEl, async () => {
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

    // Populating the panel: name and icon
    document.getElementById("container-info-name").textContent = identity.name;

    const icon = document.getElementById("container-info-icon");
    icon.setAttribute("data-identity-icon", identity.icon);
    icon.setAttribute("data-identity-color", identity.color);

    // Show or not the has-tabs section.
    for (let trHasTabs of document.getElementsByClassName("container-info-has-tabs")) { // eslint-disable-line prefer-const
      trHasTabs.style.display = !identity.hasHiddenTabs && !identity.hasOpenTabs ? "none" : "";
    }

    const hideShowIcon = document.getElementById("container-info-hideorshow-icon");
    hideShowIcon.src = identity.hasHiddenTabs ? CONTAINER_UNHIDE_SRC : CONTAINER_HIDE_SRC;

    const hideShowLabel = document.getElementById("container-info-hideorshow-label");
    hideShowLabel.textContent = identity.hasHiddenTabs ? "Show this container" : "Hide this container";

    // Let's remove all the previous tabs.
    const table = document.getElementById("container-info-table");
    while (table.firstChild) {
      table.firstChild.remove();
    }

    // Let's retrieve the list of tabs.
    const tabs = await browser.runtime.sendMessage({
      method: "getTabs",
      windowId: browser.windows.WINDOW_ID_CURRENT,
      cookieStoreId: Logic.currentIdentity().cookieStoreId
    });
    return this.buildInfoTable(tabs);
  },

  buildInfoTable(tabs) {
    // For each one, let's create a new line.
    const fragment = document.createDocumentFragment();
    for (let tab of tabs) { // eslint-disable-line prefer-const
      const tr = document.createElement("tr");
      fragment.appendChild(tr);
      tr.classList.add("container-info-tab-row");
      tr.innerHTML = escaped`
        <td></td>
        <td class="container-info-tab-title truncate-text" title="${tab.url}" ><div class="container-tab-title">${tab.title}</div></td>`;
      tr.querySelector("td").appendChild(Utils.createFavIconElement(tab.favIconUrl));
      tr.setAttribute("tabindex", "0");
      document.getElementById("container-info-table").appendChild(fragment);

      // On click, we activate this tab. But only if this tab is active.
      if (!tab.hiddenState) {
        const closeImage = document.createElement("img");
        closeImage.src = "/img/container-close-tab.svg";
        closeImage.className = "container-close-tab";
        closeImage.title = "Close tab";
        closeImage.id = tab.id;
        const tabTitle = tr.querySelector(".container-info-tab-title");
        tabTitle.appendChild(closeImage);

        // On hover, we add truncate-text class to add close-tab-image after tab title truncates
        const tabTitleHoverEvent = () => {
          tabTitle.classList.toggle("truncate-text");
          tr.querySelector(".container-tab-title").classList.toggle("truncate-text");
        };

        tr.addEventListener("mouseover", tabTitleHoverEvent);
        tr.addEventListener("mouseout", tabTitleHoverEvent);

        tr.classList.add("clickable");
        Logic.addEnterHandler(tr, async () => {
          await browser.tabs.update(tab.id, { active: true });
          window.close();
        });

        const closeTab = document.getElementById(tab.id);
        if (closeTab) {
          Logic.addEnterHandler(closeTab, async (e) => {
            await browser.tabs.remove(Number(e.target.id));
            window.close();
          });
        }
      }
    }
  },
});

// P_CONTAINERS_EDIT: Makes the list editable.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINERS_EDIT, {
  panelSelector: "#edit-containers-panel",

  // This method is called when the object is registered.
  initialize() {
    Logic.addEnterHandler(document.querySelector("#exit-edit-mode-link"), () => {
      Logic.showPanel(P_CONTAINERS_LIST);
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    const fragment = document.createDocumentFragment();
    Logic.identities().forEach(identity => {
      const tr = document.createElement("tr");
      fragment.appendChild(tr);
      tr.classList.add("container-panel-row");
      tr.innerHTML = escaped`
        <td class="userContext-wrapper">
          <div class="userContext-icon-wrapper">
            <div class="usercontext-icon"
              data-identity-icon="${identity.icon}"
              data-identity-color="${identity.color}">
            </div>
          </div>
          <div class="container-name truncate-text"></div>
        </td>
        <td class="edit-container pop-button edit-container-icon">
          <img
            src="/img/container-edit.svg"
            class="pop-button-image" />
        </td>
        <td class="remove-container pop-button delete-container-icon">
          <img
            class="pop-button-image"
            src="/img/container-delete.svg"
          />
        </td>`;
      tr.querySelector(".container-name").textContent = identity.name;
      tr.querySelector(".edit-container").setAttribute("title", `Edit ${identity.name} container`);
      tr.querySelector(".remove-container").setAttribute("title", `Remove ${identity.name} container`);


      Logic.addEnterHandler(tr, e => {
        if (e.target.matches(".edit-container-icon") || e.target.parentNode.matches(".edit-container-icon")) {
          Logic.showPanel(P_CONTAINER_EDIT, identity);
        } else if (e.target.matches(".delete-container-icon") || e.target.parentNode.matches(".delete-container-icon")) {
          Logic.showPanel(P_CONTAINER_DELETE, identity);
        }
      });
    });

    const list = document.querySelector("#edit-identities-list");

    list.innerHTML = "";
    list.appendChild(fragment);

    return Promise.resolve(null);
  },
});

// P_CONTAINER_EDIT: Editor for a container.
// ----------------------------------------------------------------------------

Logic.registerPanel(P_CONTAINER_EDIT, {
  panelSelector: "#edit-container-panel",

  // This method is called when the object is registered.
  initialize() {
    this.initializeRadioButtons();

    Logic.addEnterHandler(document.querySelector("#edit-container-panel-back-arrow"), () => {
      const formValues = new FormData(this._editForm);
      if (formValues.get("container-id") !== NEW_CONTAINER_ID) {
        this._submitForm();
      } else {
        Logic.showPreviousPanel();
      }
    });

    Logic.addEnterHandler(document.querySelector("#edit-container-cancel-link"), () => {
      Logic.showPreviousPanel();
    });

    this._editForm = document.getElementById("edit-container-panel-form");
    const editLink = document.querySelector("#edit-container-ok-link");
    Logic.addEnterHandler(editLink, () => {
      this._submitForm();
    });
    editLink.addEventListener("submit", () => {
      this._submitForm();
    });
    this._editForm.addEventListener("submit", () => {
      this._submitForm();
    });

    // Add new site to current container
    const siteLink = document.querySelector("#edit-container-site-link");
    Logic.addEnterHandler(siteLink, () => {
      this._addSite();
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

  async _addSite() {
    // Get URL and container ID from form
    const formValues = new FormData(this._editForm);
    const url = formValues.get("site-name");
    const userContextId = formValues.get("container-id");
    const currentTab = await Logic.currentTab();
    const tabId = currentTab.id;
    const fullURL = this.checkUrl(url);

    if (fullURL !== null) { 
      // Assign URL to container
      await Logic.setOrRemoveAssignment(tabId, fullURL, userContextId, false);

      // Clear form
      document.querySelector("#edit-container-panel-site-input").value = "";

      // Show new assignments
      const assignments = await Logic.getAssignmentObjectByContainer(userContextId);
      this.showAssignedContainers(assignments); 
    }
  },

  checkUrl(url){
    const validUrl = /[\w.-]+(?:\.[\w.-]+)/g;
    const regexProtocol = /^https?:\/\/.*/g;
    const valid = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+|(?:www\.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w\-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[.!/\\\w]*))?)/g;
    let newURL = url;
    
    if (!url.match(validUrl)) {
      return null;
    }

    // append "https://" if protocol not found
    if (!url.match(regexProtocol)) {
      newURL = "https://" + url;
    }

    if (!newURL.match(valid)) {
      return null;
    }
    return newURL;
  },

  showAssignedContainers(assignments) {
    const assignmentPanel = document.getElementById("edit-sites-assigned");
    const assignmentKeys = Object.keys(assignments);
    assignmentPanel.hidden = !(assignmentKeys.length > 0);
    if (assignments) {
      const tableElement = assignmentPanel.querySelector(".assigned-sites-list");
      /* Remove previous assignment list,
         after removing one we rerender the list */
      while (tableElement.firstChild) {
        tableElement.firstChild.remove();
      }

      assignmentKeys.forEach((siteKey) => {
        const site = assignments[siteKey];
        const trElement = document.createElement("div");
        /* As we don't have the full or correct path the best we can assume is the path is HTTPS and then replace with a broken icon later if it doesn't load.
           This is pending a better solution for favicons from web extensions */
        const assumedUrl = `https://${site.hostname}/favicon.ico`;
        trElement.innerHTML = escaped`
        <div class="favicon"></div>
        <div title="${site.hostname}" class="truncate-text hostname">
          ${site.hostname}
        </div>
        <img
          class="pop-button-image delete-assignment"
          src="/img/container-delete.svg"
        />`;
        trElement.getElementsByClassName("favicon")[0].appendChild(Utils.createFavIconElement(assumedUrl));
        const deleteButton = trElement.querySelector(".delete-assignment");
        const that = this;
        Logic.addEnterHandler(deleteButton, async () => {
          const userContextId = Logic.currentUserContextId();
          // Lets show the message to the current tab
          // TODO remove then when firefox supports arrow fn async
          const currentTab = await Logic.currentTab();
          Logic.setOrRemoveAssignment(currentTab.id, assumedUrl, userContextId, true);
          delete assignments[siteKey];
          that.showAssignedContainers(assignments);
        });
        trElement.classList.add("container-info-tab-row", "clickable");
        tableElement.appendChild(trElement);
      });
    }
  },

  initializeRadioButtons() {
    const colorRadioTemplate = (containerColor) => {
      return escaped`<input type="radio" value="${containerColor}" name="container-color" id="edit-container-panel-choose-color-${containerColor}" />
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
      return escaped`<input type="radio" value="${containerIcon}" name="container-icon" id="edit-container-panel-choose-icon-${containerIcon}" />
     <label for="edit-container-panel-choose-icon-${containerIcon}" class="usercontext-icon choose-color-icon" data-identity-color="grey" data-identity-icon="${containerIcon}">`;
    };
    const icons = ["fingerprint", "briefcase", "dollar", "cart", "vacation", "gift", "food", "fruit", "pet", "tree", "chill", "circle"];
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

    const userContextId = Logic.currentUserContextId();
    const assignments = await Logic.getAssignmentObjectByContainer(userContextId);
    this.showAssignedContainers(assignments);
    document.querySelector("#edit-container-panel .panel-footer").hidden = !!userContextId;
    // Only show ability to add site if it's an existing container
    document.querySelector("#edit-container-panel-add-site").hidden = !userContextId;
    // Make site input empty
    document.querySelector("#edit-container-panel-site-input").value = "";
    document.querySelector("#edit-container-panel-name-input").value = identity.name || "";
    document.querySelector("#edit-container-panel-usercontext-input").value = userContextId || NEW_CONTAINER_ID;
    const containerName = document.querySelector("#edit-container-panel-name-input");
    window.requestAnimationFrame(() => {
      containerName.select();
      containerName.focus();
    });
    [...document.querySelectorAll("[name='container-color']")].forEach(colorInput => {
      colorInput.checked = colorInput.value === identity.color;
    });
    [...document.querySelectorAll("[name='container-icon']")].forEach(iconInput => {
      iconInput.checked = iconInput.value === identity.icon;
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
    Logic.addEnterHandler(document.querySelector("#delete-container-cancel-link"), () => {
      Logic.showPreviousPanel();
    });

    Logic.addEnterHandler(document.querySelector("#delete-container-ok-link"), async () => {
      /* This promise wont resolve if the last tab was removed from the window.
          as the message async callback stops listening, this isn't an issue for us however it might be in future
          if you want to do anything post delete do it in the background script.
          Browser console currently warns about not listening also.
      */
      try {
        await Logic.removeIdentity(Logic.userContextId(Logic.currentIdentity().cookieStoreId));
        await Logic.refreshIdentities();
        Logic.showPreviousPanel();
      } catch (e) {
        Logic.showPanel(P_CONTAINERS_LIST);
      }
    });
  },

  // This method is called when the panel is shown.
  prepare() {
    const identity = Logic.currentIdentity();

    // Populating the panel: name, icon, and warning message
    document.getElementById("delete-container-name").textContent = identity.name;

    const totalNumberOfTabs = identity.numberOfHiddenTabs + identity.numberOfOpenTabs;
    let warningMessage = "";
    if (totalNumberOfTabs > 0) {
      const grammaticalNumTabs = totalNumberOfTabs > 1 ? "tabs" : "tab";
      warningMessage = `If you remove this container now, ${totalNumberOfTabs} container ${grammaticalNumTabs} will be closed.`;
    }
    document.getElementById("delete-container-tab-warning").textContent = warningMessage;

    const icon = document.getElementById("delete-container-icon");
    icon.setAttribute("data-identity-icon", identity.icon);
    icon.setAttribute("data-identity-color", identity.color);

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
    Logic.addEnterHandler(document.querySelector("#achievement-done-button"), async () => {
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
