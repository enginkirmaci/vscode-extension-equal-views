'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const patcher = require('../src/patcher');

/**
 * A very small stand-in for the workbench DOM: enough of Element, classList,
 * events and geometry for the side-car to run, plus the double-click behaviour
 * of PaneView#onDidSashReset.
 */
class FakeElement {
  constructor(classes) {
    this.classes = new Set(classes);
    this.children = [];
    this.parentElement = null;
    this.height = 0;
    this.width = 0;
    this.isConnected = true;
    this.listeners = new Map();
    const classes_ = this.classes;
    this.classList = {
      contains: (name) => classes_.has(name),
      add: (name) => classes_.add(name),
      remove: (name) => classes_.delete(name)
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  getBoundingClientRect() {
    return { height: this.height, width: this.width || 100 };
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) {
      listener(event);
    }
    return true;
  }

  querySelectorAll(selector) {
    const wanted = selector.replace(/^\./, '');
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.classList.contains(wanted)) {
          found.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    const wanted = selector.replace(/^\./, '');
    let node = this;
    while (node) {
      if (node.classList && node.classList.contains(wanted)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }
}

function fixture(heights, collapsed) {
  const part = new FakeElement(['part', 'sidebar']);
  part.height = heights.reduce((total, value) => total + value, 0);

  const paneView = part.appendChild(new FakeElement(['monaco-pane-view']));
  paneView.height = part.height;

  const splitView = paneView.appendChild(new FakeElement(['monaco-split-view2', 'vertical']));
  const container = splitView.appendChild(new FakeElement(['split-view-container']));
  const sashes = splitView.appendChild(new FakeElement(['sash-container']));

  const cells = heights.map((height, index) => {
    const cell = container.appendChild(new FakeElement(['split-view-view']));
    cell.height = height;
    const pane = cell.appendChild(new FakeElement(collapsed.includes(index) ? ['pane'] : ['pane', 'expanded']));
    pane.appendChild(new FakeElement(['pane-header']));
    return cell;
  });

  // One splitter between each pair, as SplitView builds them.
  for (let index = 0; index < cells.length - 1; index++) {
    const sash = sashes.appendChild(new FakeElement(['monaco-sash', 'horizontal']));
    sash.height = 4;
    sash.addEventListener('dblclick', () => {
      const top = findPane(cells, index, -1);
      const bottom = findPane(cells, index + 1, 1);
      if (!top || !bottom) {
        return;
      }
      const total = top.height + bottom.height;
      const high = Math.ceil(total / 2);
      const low = Math.floor(total / 2);
      if (top.height > bottom.height) {
        top.height = high;
        bottom.height = low;
      } else {
        bottom.height = low;
        top.height = high;
      }
    });
  }

  return { part, paneView, splitView, container, sashes, cells };
}

function findPane(cells, start, step) {
  for (let index = start; index >= 0 && index < cells.length; index += step) {
    const pane = cells[index].firstElementChild;
    if (pane.classList.contains('expanded')) {
      return cells[index];
    }
  }
  return null;
}

function run(code, options) {
  const sandbox = {
    console: { log() {}, error() {} },
    document: {
      querySelector: (selector) => (selector === '.part.sidebar' ? options.part : null)
    },
    MouseEvent: class MouseEvent {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    window: {
      // unref keeps the side-car's own timers from holding the test process open
      setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
      setInterval: (callback, ms) => setInterval(callback, ms).unref(),
      clearTimeout,
      requestAnimationFrame: (callback) => setTimeout(callback, 4).unref()
    }
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(code, sandbox, { filename: 'equalizer.js' });
  return sandbox;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payload(targets) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'media', 'equalizer.js'), 'utf8');
  return patcher.buildPayload(template, { targets, interval: 20, debug: false });
}

test('equalises expanded views through the splitter double click', async () => {
  const { part, cells } = fixture([500, 100, 200], []);
  run(payload(['sidebar']), { part });

  await wait(250);

  const heights = cells.map((cell) => cell.height);
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 2, `heights: ${heights.join(', ')}`);
});

test('leaves collapsed views alone and shares the space between the rest', async () => {
  const { part, cells } = fixture([400, 40, 160], [1]);
  run(payload(['sidebar']), { part });

  await wait(250);

  assert.equal(cells[1].height, 40);
  assert.ok(Math.abs(cells[0].height - cells[2].height) <= 2, `heights: ${cells[0].height}, ${cells[2].height}`);
});

test('a manual splitter drag is respected until the shape changes', async () => {
  const { part, cells } = fixture([300, 300], []);
  run(payload(['sidebar']), { part });

  await wait(120);
  const sash = part.querySelector('.sash-container').children[0];
  cells[0].height = 450;
  cells[1].height = 150;
  // pointerdown on the splitter tells the side-car the user took over.
  const down = { type: 'pointerdown', target: sash, bubbles: true };
  part.dispatchEvent(down);

  await wait(200);
  assert.deepEqual([cells[0].height, cells[1].height], [450, 150]);

  // Resizing the region resets the take-over, so the next tick balances again.
  part.height = 700;
  part.querySelector('.monaco-pane-view').height = 700;
  cells[0].height = 500;
  cells[1].height = 200;

  await wait(250);
  assert.ok(Math.abs(cells[0].height - cells[1].height) <= 2, `heights: ${cells[0].height}, ${cells[1].height}`);
});

test('does nothing when fewer than two views are expanded', async () => {
  const { part, cells } = fixture([500, 60], [1]);
  run(payload(['sidebar']), { part });

  await wait(150);
  assert.deepEqual([cells[0].height, cells[1].height], [500, 60]);
});

test('honours the configured targets', () => {
  const sandbox = run(payload(['panel']), { part: null });
  assert.equal(sandbox.window.__equalViewsLoaded, true);
});
