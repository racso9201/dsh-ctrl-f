// Dev harness for dsh-ctrl-f: runs client.js against a fake DOM so paging,
// searching and keyboard stepping can be checked without the app.
//
//   node test/harness.js
//
// Not published (see package.json "files").
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const CLIENT = path.join(__dirname, '..', 'client.js');

/* ------------------------------- fake DOM ------------------------------- */

class TextNode {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = null;
  }
  get textContent() { return this.nodeValue; }
}

class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentElement = null;
    this.attrs = new Map();
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.className = '';
    this.isConnected = true;
    this.scrollTop = 0;
    this.scrolls = 0;
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(value) { this.childNodes = []; if (value) this.append(new TextNode(value)); }
  append(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  prepend(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.childNodes.unshift(child);
    return child;
  }
  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentElement = null;
    return child;
  }
  appendChild(child) { return this.append(child); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  hasAttribute(name) { return this.attrs.has(name); }
  get scrollHeight() { return countRows(this) * 100 + 200; }
  scrollIntoView() { this.scrolls += 1; }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  matches(selector) {
    for (const part of selector.split(',').map((s) => s.trim())) {
      if (!part) continue;
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attr) {
        if (!this.attrs.has(attr[1])) continue;
        if (attr[2] !== undefined && this.attrs.get(attr[1]) !== attr[2]) continue;
        return true;
      }
      if (this.tagName === part.toUpperCase()) return true;
    }
    return false;
  }
  querySelectorAll(selector) {
    const out = [];
    walk(this, (node) => { if (node.nodeType === 1 && node !== this && node.matches(selector)) out.push(node); });
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function walk(root, visit) {
  for (const child of root.childNodes) {
    visit(child);
    if (child.nodeType === 1) walk(child, visit);
  }
}

function countRows(root) {
  let rows = 0;
  walk(root, (node) => { if (node.nodeType === 1 && node.hasAttribute('data-chat-flow-kind')) rows += 1; });
  return rows;
}

function makeDocument(body) {
  const doc = {
    body,
    head: new El('head'),
    listeners: {},
    createElement: (tag) => new El(tag),
    createTreeWalker(root, _what, filter) {
      const nodes = [];
      walk(root, (node) => {
        if (node.nodeType !== 3 || !node.nodeValue) return;
        if (filter && filter.acceptNode && filter.acceptNode(node) !== 1) return;
        nodes.push(node);
      });
      let at = 0;
      return { nextNode: () => nodes[at++] || null };
    },
    createRange() {
      const range = {
        startContainer: null,
        setStart(node, offset) { range.startContainer = node; range.startOffset = offset; },
        setEnd(node, offset) { range.endContainer = node; range.endOffset = offset; },
      };
      return range;
    },
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener(type, handler) { (doc.listeners[type] = doc.listeners[type] || []).push(handler); },
    removeEventListener(type, handler) {
      const list = doc.listeners[type] || [];
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    },
    dispatch(type, event) { for (const handler of [...(doc.listeners[type] || [])]) handler(event); },
  };
  return doc;
}

/* ------------- transcript fixture: 3 pages x 12 answer rows ------------- */

function buildTranscript() {
  const totalPages = 3;
  const perPage = 12;
  const body = new El('body');
  const scroll = body.append(new El('div'));
  scroll.setAttribute('data-conversation-scroll', '');
  const content = scroll.append(new El('div'));
  content.setAttribute('data-conversation-content', '');
  const pagerHost = scroll.append(new El('div'));
  pagerHost.className = 'V4vHZW_older';
  const pager = pagerHost.append(new El('button'));
  pager.textContent = '載入更早';

  let loadedFrom = totalPages - 1; // a fresh scroll shows only the last page
  const clicks = { count: 0 };

  const render = () => {
    content.childNodes = [];
    for (let page = loadedFrom; page < totalPages; page += 1) {
      for (let i = page * perPage; i < (page + 1) * perPage; i += 1) {
        const row = new El('div');
        row.setAttribute('data-chat-flow-kind', 'assistant-step');
        row.setAttribute('data-chat-group-part', 'response');
        row.setAttribute('data-chat-node-key', `row-${i}`);
        row.append(new TextNode(`segment ${i} — body of row ${i}`));
        content.append(row);
      }
    }
    if (loadedFrom <= 0 && pager.parentElement) pagerHost.removeChild(pager);
  };

  render();

  // The plugin calls button.click(); emulate the chat view's pager.
  pager.click = () => {
    clicks.count += 1;
    if (loadedFrom > 0) {
      loadedFrom -= 1;
      render();
    }
  };
  Object.defineProperty(pager, 'disabled', { get: () => false, set: () => {} });

  return { body, scroll, content, pager, pagerHost, clicks, totalPages, perPage };
}

/* ------------------------------- fake React ----------------------------- */

const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  useReducer: (_fn, initial) => [initial, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
};

/* --------------------------------- run ---------------------------------- */

const fixture = buildTranscript();
const document = makeDocument(fixture.body);
const highlights = new Map();

class Highlight {
  constructor(...ranges) { this.ranges = ranges.flat(); }
}

let loaded = null;
const sandbox = {
  console,
  document,
  navigator: { platform: 'Win32', language: process.env.HARNESS_LANG || 'zh-TW' },
  NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
  CSS: { highlights },
  Highlight,
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  __ModuleLoader__: { load: (mod) => { loaded = mod; } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);
const source = fs.readFileSync(CLIENT, 'utf8');
new vm.Script(source, { filename: CLIENT }).runInContext(context);

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const mod = loaded;
check('module registered', Boolean(mod && mod.id === 'dsh-ctrl-f'), mod && mod.id);

let component = null;
const api = mod.factory((name) => {
  if (name === 'react') return react;
  throw new Error(`unexpected require(${name})`);
});
api.apply({
  slots: {
    inject: (_owner, factory) => factory(),
    register: (_meta, Comp) => { component = Comp; return () => {}; },
  },
  effect: (fn) => { fn(); return () => {}; },
  shortcuts: { register: () => () => {} },
});
check('find bar registered', typeof component === 'function');

const key = (overrides) => {
  const event = {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() { event.propagationStopped = true; },
    ...overrides,
  };
  return event;
};

const pressCtrlF = () => {
  const event = key({ key: 'f', code: 'KeyF', ctrlKey: true });
  document.dispatch('keydown', event);
  return event;
};
const press = (overrides) => {
  const event = key(overrides);
  document.dispatch('keydown', event);
  return event;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate, cap = 6000) {
  const started = Date.now();
  while (Date.now() - started < cap) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
}

const rowsNow = () => document.querySelectorAll('[data-chat-flow-kind]').length;
const currentText = () => {
  const hit = highlights.get('dsh-find-current');
  const range = hit && hit.ranges[0];
  return range ? String(range.startContainer.nodeValue) : '';
};

const findInput = () => {
  const tree = component({});
  let input = null;
  (function scan(node) {
    if (!node || typeof node !== 'object' || input) return;
    if (node.type === 'input' && node.props && 'placeholder' in node.props) { input = node; return; }
    for (const child of node.props ? node.props.children || [] : []) scan(child);
  })(tree);
  return input;
};

async function main() {
  pressCtrlF();
  await waitUntil(() => rowsNow() === fixture.totalPages * fixture.perPage && !fixture.pager.parentElement);
  await sleep(300);

  check('pager clicked for every page', fixture.clicks.count === fixture.totalPages - 1, `clicks=${fixture.clicks.count}`);
  check('whole transcript mounted', rowsNow() === fixture.totalPages * fixture.perPage, `rows=${rowsNow()}`);

  const input = findInput();
  check('input rendered', Boolean(input));

  const english = (process.env.HARNESS_LANG || 'zh-TW').startsWith('en');
  const wantPlaceholder = english ? 'Search answers only' : '只在回覆中尋找';
  check('bar speaks the app language', input.props.placeholder === wantPlaceholder, input.props.placeholder);

  const includeLabel = (function scan(node) {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'label') {
      const text = (node.props.children || []).filter((child) => typeof child === 'string');
      if (text.length) return text.join('');
    }
    for (const child of node.props ? node.props.children || [] : []) {
      const found = scan(child);
      if (found) return found;
    }
    return '';
  })(component({}));
  check('include-process label', includeLabel === (english ? 'Agent reasoning' : '含agent 思考過程'), includeLabel);

  input.props.onChange({ target: { value: 'segment 3' } });
  const all = highlights.get('dsh-find-all');
  check('search covers pre-pager history', Boolean(all && all.ranges.length >= 1), `matches=${all ? all.ranges.length : 0}`);

  const first = currentText();
  const clicksBefore = fixture.clicks.count;
  const down = press({ key: 'ArrowDown' });
  const second = currentText();
  check('ArrowDown consumes the key', down.defaultPrevented && down.propagationStopped === true);
  check('ArrowDown moves to the next match', second !== '' && second !== first, `${first.slice(0, 12)} -> ${second.slice(0, 12)}`);
  check('ArrowDown does not page again', fixture.clicks.count === clicksBefore, `clicks=${fixture.clicks.count}`);

  const up = press({ key: 'ArrowUp' });
  check('ArrowUp consumes the key', up.defaultPrevented === true);
  check('ArrowUp returns to the previous match', currentText() === first, `${currentText().slice(0, 12)}`);

  const shiftDown = press({ key: 'ArrowDown', shiftKey: true });
  check('Shift+ArrowDown is left to the page', shiftDown.defaultPrevented === false);

  input.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {}, currentTarget: { select() {} } });
  const idle = press({ key: 'ArrowDown' });
  check('closed bar keeps arrows for scrolling', idle.defaultPrevented === false);

  const clicksBeforeReopen = fixture.clicks.count;
  pressCtrlF();
  await sleep(400);
  check('reopen does not re-page', fixture.clicks.count === clicksBeforeReopen, `clicks=${fixture.clicks.count}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
