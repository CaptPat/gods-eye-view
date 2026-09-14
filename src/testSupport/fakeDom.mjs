// src/testSupport/fakeDom.mjs
/** Minimal DOM stand-in for browser-module tests: tree, text, classes, attributes, events and focus. */
class FakeElement extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    this._classes = new Set();
    this._rect = { left: 0, top: 0, width: 0, height: 0 };
    const classes = this._classes;
    this.classList = {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
      toggle: (value, force = !classes.has(value)) => {
        if (force) classes.add(value);
        else classes.delete(value);
        return force;
      },
    };
  }

  get className() {
    return [...this._classes].join(' ');
  }
  set className(value) {
    this._classes.clear();
    String(value)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((name) => this._classes.add(name));
  }
  get id() {
    return this.attributes.get('id') ?? '';
  }
  set id(value) {
    this.attributes.set('id', String(value));
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(node) {
    node.remove();
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(
        typeof node === 'string'
          ? this.ownerDocument.createTextNode(node)
          : node,
      );
    }
  }
  prepend(node) {
    node.remove();
    node.parentNode = this;
    this.children.unshift(node);
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) child.remove();
    this._text = '';
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode)
      if (current === this) return true;
    return false;
  }

  get textContent() {
    return (
      this._text + this.children.map((child) => child.textContent).join('')
    );
  }
  set textContent(value) {
    for (const child of [...this.children]) child.remove();
    this._text = String(value);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
  click() {
    this.dispatchEvent(new Event('click'));
  }
  getBoundingClientRect() {
    return this._rect;
  }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this._classes.has(selector.slice(1));
    const attribute = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (attribute) return this.getAttribute(attribute[1]) === attribute[2];
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export function createFakeDocument() {
  const document = new EventTarget();
  document.activeElement = null;
  document.createElement = (tagName) => new FakeElement(tagName, document);
  document.createTextNode = (text) => {
    const node = new FakeElement('#text', document);
    node._text = String(text);
    return node;
  };
  document.body = document.createElement('body');
  document.getElementById = (id) => document.body.querySelector(`#${id}`);
  return document;
}

export function installFakeDocument(t) {
  const prior = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  t.after(() => {
    globalThis.document = prior;
  });
  return document;
}
