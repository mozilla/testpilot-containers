const NUMBER_OF_KEYBOARD_SHORTCUTS = 10;

async function requestPermissions() {
  const checkbox = document.querySelector("#bookmarksPermissions");
  if (checkbox.checked) {
    const granted = await browser.permissions.request({permissions: ["bookmarks"]});
    if (!granted) { 
      checkbox.checked = false; 
      return;
    }
  } else {
    await browser.permissions.remove({permissions: ["bookmarks"]});
  }
  browser.runtime.sendMessage({ method: "resetBookmarksContext" });
}

async function enableDisableSync() {
  const checkbox = document.querySelector("#syncCheck");
  await browser.storage.local.set({syncEnabled: !!checkbox.checked});
  browser.runtime.sendMessage({ method: "resetSync" });
}

async function enableDisableReplaceTab() {
  const checkbox = document.querySelector("#replaceTabCheck");
  await browser.storage.local.set({replaceTabEnabled: !!checkbox.checked});
}

async function setupOptions() {
  const backupLink = document.getElementById("containers-save-link");
  const backupResult = document.getElementById("containers-save-result");
  document.getElementById("containers-save-button").addEventListener("click", async e => {
    e.preventDefault();
    try {
      const content = JSON.stringify(
        await browser.runtime.sendMessage({
          method: "backupIdentitiesState"
        })
      );
      backupLink.href = `data:application/json;base64,${btoa(content)}`;
      backupLink.download = `containers-backup-${(new Date()).toISOString()}.json`;
      backupLink.click();
      backupResult.textContent = "";
    } catch (err) {
      backupResult.textContent = `Something goes wrong: ${err.message || err}`;
      backupResult.style.color = "red";
    }
  }, { capture: true, passive: false });

  const restoreInput = document.getElementById("containers-restore-input");
  const restoreResult = document.getElementById("containers-restore-result");
  restoreInput.addEventListener("change", e => {
    e.preventDefault();
    if (restoreInput.files.length) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const identitiesState = JSON.parse(reader.result);
          const { created: restoredCount, incomplete } = await browser.runtime.sendMessage({
            method: "restoreIdentitiesState",
            identities: identitiesState
          });
          if (incomplete.length === 0) {
            restoreResult.textContent = `${restoredCount} containers restored.`;
            restoreResult.style.color = "green";
          } else {
            restoreResult.textContent = `${restoredCount} containers restored, but some lost their site association (${incomplete.join(", ")}).`;
            restoreResult.style.color = "orange";
          }
        } catch (err) {
          console.error("Cannot restore containers list: %s", err.message || err);
          restoreResult.textContent = "The file is corrupted, or isn't a container backup file.";
          restoreResult.style.color = "red";
        }
      };
      reader.readAsText(restoreInput.files.item(0));
    }
    restoreInput.value = "";
  });

  const hasPermission = await browser.permissions.contains({permissions: ["bookmarks"]});
  const { syncEnabled } = await browser.storage.local.get("syncEnabled");
  const { replaceTabEnabled } = await browser.storage.local.get("replaceTabEnabled");
  if (hasPermission) {
    document.querySelector("#bookmarksPermissions").checked = true;
  }
  document.querySelector("#syncCheck").checked = !!syncEnabled;
  document.querySelector("#replaceTabCheck").checked = !!replaceTabEnabled;
  setupContainerShortcutSelects();
}

async function setupContainerShortcutSelects () {
  const keyboardShortcut = await browser.runtime.sendMessage({method: "getShortcuts"});
  const identities = await browser.contextualIdentities.query({});
  const fragment = document.createDocumentFragment();
  const noneOption = document.createElement("option");
  noneOption.value = "none";
  noneOption.id = "none";
  noneOption.textContent = "None";
  fragment.append(noneOption);

  for (const identity of identities) {
    const option = document.createElement("option");
    option.value = identity.cookieStoreId;
    option.id = identity.cookieStoreId;
    option.textContent = identity.name;
    fragment.append(option);
  }

  for (let i=0; i < NUMBER_OF_KEYBOARD_SHORTCUTS; i++) {
    const shortcutKey = "open_container_"+i;
    const shortcutSelect = document.getElementById(shortcutKey);
    shortcutSelect.appendChild(fragment.cloneNode(true));
    if (keyboardShortcut && keyboardShortcut[shortcutKey]) {
      const cookieStoreId = keyboardShortcut[shortcutKey];
      shortcutSelect.querySelector("#" + cookieStoreId).selected = true;
    }
  }
}

function storeShortcutChoice (event) {
  browser.runtime.sendMessage({
    method: "setShortcut",
    shortcut: event.target.id,
    cookieStoreId: event.target.value
  });
}

function resetOnboarding() {
  browser.storage.local.set({"onboarding-stage": 0});
}

document.addEventListener("DOMContentLoaded", setupOptions);
document.querySelector("#bookmarksPermissions").addEventListener( "change", requestPermissions);
document.querySelector("#syncCheck").addEventListener( "change", enableDisableSync);
document.querySelector("#replaceTabCheck").addEventListener( "change", enableDisableReplaceTab);
document.querySelector("button").addEventListener("click", resetOnboarding);

for (let i=0; i < NUMBER_OF_KEYBOARD_SHORTCUTS; i++) {
  document.querySelector("#open_container_"+i)
    .addEventListener("change", storeShortcutChoice);
}