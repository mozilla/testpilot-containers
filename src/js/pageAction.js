async function init() {
  const fragment = document.createDocumentFragment();

  const identities = await browser.contextualIdentities.query({});

  identities.forEach(identity => {
    const tr = document.createElement("tr");
    tr.classList.add("menu-item", "hover-highlight");
    const td = document.createElement("td");

    td.innerHTML = Utils.escaped`          
        <div class="menu-icon">
          <div class="usercontext-icon"
            data-identity-icon="${identity.icon}"
            data-identity-color="${identity.color}">
          </div>
        </div>
        <span class="menu-text">${identity.name}</span>`;
    
    tr.appendChild(td);
    fragment.appendChild(tr);

    Utils.addEnterHandler(tr, async () => {
      Utils.alwaysOpenInContainer(identity);
      window.close();
    });
  });

  const list = document.querySelector("#picker-identities-list");

  list.innerHTML = "";
  list.appendChild(fragment);
}

init();
