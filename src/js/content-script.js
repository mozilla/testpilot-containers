function asError(reason) { return reason && (reason instanceof Error) ? reason : new Error(reason); }
function resolves(value) { return (resolve) => { resolve(value); }; }
// function rejects(reason) { return (resolve, reject) => { reject(asError(reason)); }; }

// Easily build promises that:
//  1. combine reusable behaviours (e.g. onTimeout, onEvent)
//  2. have a cleanup phase        (e.g. to remove listeners)
//  3. can be interrupted          (e.g. on unload)
class PromiseBuilder {
  constructor() {
    this._promise = Promise.race([
      // Interrupter
      new Promise((resolve, reject) => { this.interrupt = reject; }),
      // Main
      new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = (reason, options) => {
          (options && options.interrupt ? this.interrupt : reject)(asError(reason));
        };
      // Cleanup
      }).finally(() => { if (this.completions) { this.completions.forEach((completion) => { completion(); }); } })
    ]);
  }
  
  async _tryHandler(handler, name, ...args) {
    try {
      await handler(...args);
    } catch (e) {
      console.error(`Failed: ${name}: ${e.message}`);
      this.reject(e);
    }
  }
  
  promise(handler) {
    if (handler) { this._tryHandler(handler, "promise", this); }
    return this._promise;
  }
  
  onCompletion(completion) {
    if (!this.completions) { this.completions = []; }
    this.completions.push(completion);
    return this;
  }
  
  onTimeout(delay, timeoutHandler) {
    const timer = () => { this._tryHandler(timeoutHandler, "timeout", this.resolve, this.reject); };
    let timeoutId = setTimeout(() => { timeoutId = null; timer(); }, delay);
    this.onCompletion(() => { clearTimeout(timeoutId); });
    return this;
  }
  
  onFutureEvent(target, eventName, eventHandler) {
    const listener = (event) => { this._tryHandler(eventHandler, eventName, this.resolve, this.reject, event); };
    target.addEventListener(eventName, listener, {once: true});
    this.onCompletion(() => { target.removeEventListener(eventName, listener); });
    return this;
  }
  
  onEvent(target, eventName, eventHandler) {
    if (target === window) {
      eventName = eventName.toLowerCase();
      if (eventName === "domcontentloaded" || eventName === "load") {
        switch (document.readyState) {
        case "loading": break;
        case "interactive":
          if (eventName === "load") { break; }
          // Fall through
        case "complete":
          // Event already fired - run immediately
          this._tryHandler(eventHandler, eventName, this.resolve, this.reject);
          return this; 
        }
      }
    }
    this.onFutureEvent(target, eventName, eventHandler);
    return this;
  }
}

class Animation {
  static delay(delay = 350) {
    return new Promise((resolve) => { setTimeout(resolve, delay); });
  }

  static async toggle(element, show, timeoutDelay = 3000) {
    const shown = element.classList.contains("show");
    if (shown === !!show) { return; }

    const animate = () => {
      if (show) {
        if (!element.classList.contains("show")) {
          element.classList.add("show");
        }
      } else {
        element.classList.remove("show");    
      }
    };
  
    return new PromiseBuilder()
      .onTimeout(timeoutDelay, resolves())
      .onEvent(element, "transitionend", resolves())
      .promise((promise) => {
      
        // Delay until element has been rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            animate();
          }, 10);
        });
      
        // Ensure animation always reaches final state
        promise.onCompletion(animate);
      });
  }
}

class UIRequest {
  constructor (component, action, options, response) {
    this.component = component;
    this.action = action;
    this.options = options;
    this.response = response || new UIResponse();
  }
}

class UIResponse {
  constructor (value) {
    let promise;
    if (value instanceof Promise) { promise = value; }
    if (value !== undefined) { promise = Promise.resolve(value); }
    this.modifyingDOM = this.animating = promise;
  }
}

let requests;

class UIRequestManager {
  static request(component, action, options) {
    // Try for quick return
    if (component.unique) {
      const previous = requests && requests[component.name];

      // Quick return if request already enqueued
      if (previous && previous.action === action) {
        // Previous request is also an add, but we've got an extra update to do as well
        if (action === "add" && component.onUpdate && options) {
          return new UIResponse(previous.response.animating.then((elem) => {
            const updating = component.onUpdate(elem, options);
            return updating ? updating.then(elem) : elem;
          }));
        // No update needed, so can just reuse previous request
        } else {
          return previous.response;
        }
      }
      
      // Quick return if no request pending and element already added/removed
      if (!previous) {
        const element = this._get(component);
        if (element) {
          if (action === "add") { return new UIResponse(element); }
        } else {
          if (action === "remove") { return new UIResponse(null); }
        }
      }
    }
    
    // New request
    const response = new UIResponse();
    const request = new UIRequest(component, action, options, response);
    
    // Enqueue
    let previous;
    if (component.unique) {
      if (!requests) { requests = {}; }
      previous = requests[component.name];
      requests[component.name] = request;
    }
    
    // Execute
    response.modifyingDOM = new Promise((resolve,reject) => {
      const modifiedDOM = {resolve,reject};
      response.animating = new Promise((resolve,reject) => {
        const animated = {resolve,reject};
        this._execute(request, previous, modifiedDOM, animated);
      });
    });
    
    return response;
  }
  
  static _get(component) {
    const unique = component.unique;
    if (!unique) { return null; }
    if (unique.id) {
      return document.getElementById(unique.id);
    } else {
      if ("querySelector" in component.parent) {
        return component.parent.querySelector(unique.selector);
      } else {
        const parent = this._get(component.parent);
        if (parent) {
          return parent.querySelector(unique.selector);
        } else {
          return null;
        }
      }
    }
  }
  
  static async _execute(request, previous, modifiedDOM, animated) {
    try {
      if (previous) {
        try { await previous.response.animating; } catch (e) { /* Ignore previous success/failure */ }
      }
      
      const component = request.component;
      const options = request.options;
    
      // Get parent
      let parentElement;
      if ("querySelector" in component.parent) {
        parentElement = component.parent;
      } else {
        if (request.action === "add") {
          parentElement = await this.request(component.parent, "add", options).modifyingDOM;
        } else {
          parentElement = this._get(component.parent);
        }
      }
      
      let element;
      
      // Add
      if (request.action === "add") {
        element = await component.create(options);
        if (component.onUpdate) { await component.onUpdate(element, options); }
      
        if (component.prepend) {
          parentElement.prepend(element);
        } else {
          parentElement.appendChild(element);
        }
      
        modifiedDOM.resolve(element);
        
        if (component.onAdd) { await component.onAdd(element, options); }
        
      // Remove
      } else {
        if (parentElement) {
          element = this._get(component);
          if (element) {
            if (component.onRemove) { await component.onRemove(element, options); }
            element.remove();
          }
          modifiedDOM.resolve(element);
        }
      }
      
      animated.resolve(element);
      
    } catch (e) {
      modifiedDOM.reject(e);
      animated.reject(e);
    } finally {
      if (requests[request.component.name] === request) { requests[request.component.name] = null; }
    }
  }
}

class UI {
  static async toggle(component, show, options) {
    const action = show ? "add" : "remove";
    const response = UIRequestManager.request(component, action, options);
    return response.animating;
  }
}

class Container {
  static get parent()  { return document.body; }
  static get unique()  { return { id: "container-notifications" }; }
  static create() {
    const elem = document.createElement("div");
    elem.id = this.unique.id;
    return elem;
  }
}

class Popup {
  static get parent()  { return Container; }
  static get unique()  { return { selector: "iframe" }; }
  static get prepend() { return true; }
  static create(options) {
    const elem = document.createElement("iframe");
    elem.setAttribute("sandbox", "allow-scripts allow-same-origin");
    elem.src = browser.runtime.getURL("/popup.html") + "?tabId=" + options.tabId;
    return elem;
  }
  static onUpdate(elem, options) {
    if (!options) { return; }
    if (options.width) {
      const width = options.width;
      const height = options.height || 400;
      elem.style.width = `${width}px`;
      elem.style.height = `${height}px`;
    }
  }
}

class Recording {
  static get parent()  { return Container; }
  static get unique()  { return { selector: ".recording" }; }
  static get prepend() { return true; }
  static async create() {
    const elem = await Message.create({
      title: "Recording",
      text: "Sites will be automatically added to this container as you browse in this tab"
    });
    elem.classList.add("recording");
    return elem;    
  }
  static onAdd(elem)    { return Animation.toggle(elem, true); }
  static onRemove(elem) { return Animation.toggle(elem, false); }
}

class Message {
  static get parent()  { return Container; }
  static async create(options) {
    // Message
    const msgElem = document.createElement("div");
    
    // Text
    // Ideally we would use https://bugzilla.mozilla.org/show_bug.cgi?id=1340930 when this is available
    msgElem.innerText = options.text;

    // Title
    if (options.title) {
      const titleElem = document.createElement("span");
      titleElem.classList.add("title");
      titleElem.innerText = options.title;
      msgElem.prepend(titleElem);
    }

    // Icon
    const imageElem = document.createElement("div");
    const imagePath = browser.extension.getURL("/img/container-site-d-24.png");
    imageElem.style.background = `url("${imagePath}") no-repeat center center / cover`;
    imageElem.classList.add("logo");
    msgElem.prepend(imageElem);

    // Real/dummy wrappers (required for stacking & sliding animations)
    const dummyElem = document.createElement("div");
    dummyElem.appendChild(msgElem);
    const realElem = document.importNode(dummyElem, true); // Clone
    dummyElem.classList.add("dummy"); // For sizing
    realElem.classList.add("real");   // For display

    // Outer container
    const elem = document.createElement("div");
    elem.appendChild(dummyElem);
    elem.appendChild(realElem);

    return elem;
  }
  static async onAdd(elem) {
    await Animation.toggle(elem, true);
    await Animation.delay(3000);
    await Animation.toggle(elem, false);
    elem.remove();
  }
}

class Messages {
  static async handle(message) {
    let animatePopup, animateRecording, animateMessage;
    if ("popup"     in message) { animatePopup     = UI.toggle(Popup,     message.popup, message.popupOptions); }
    if ("recording" in message) { animateRecording = UI.toggle(Recording, message.recording); }
    if ("text"      in message) { animateMessage   = UI.toggle(Message,   true, message); }
    await Promise.all([animatePopup, animateRecording, animateMessage]);
  }

  static async add(message) {
    return new PromiseBuilder()
      .onEvent(window, "unload", (resolve, reject) => { reject("window unload", {interrupt: true}); })
      .onEvent(window, "DOMContentLoaded", (resolve) => { resolve(this.handle(message)); })
      .promise();
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message.to === "tab") {
    return Messages.add(message.content);
  }
});
