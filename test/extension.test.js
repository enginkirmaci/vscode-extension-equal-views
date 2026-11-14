'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const commands = new Map();
const state = new Map();
const messages = [];

const vscodeStub = {
  version: '1.146.0',
  UIKind: { Desktop: 1, Web: 2 },
  env: { appRoot: '', uiKind: 1 },
  window: {
    showInformationMessage: async (message) => {
      messages.push(message);
      return undefined;
    },
    showErrorMessage: async (message) => {
      messages.push(message);
      return undefined;
    }
  },
  commands: {
    registerCommand: (id, handler) => {
      commands.set(id, handler);
      return { dispose() {} };
    },
    executeCommand: async () => undefined
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidChangeConfiguration: () => ({ dispose() {} })
  }
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require('../src/extension.js');
const patcher = require('../src/patcher');

Module._load = originalLoad;

function fakeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'equal-views-install-'));
  const workbench = path.join(root, 'out', 'vs', 'workbench');
  fs.mkdirSync(workbench, { recursive: true });
  const bundle = path.join(workbench, 'workbench.desktop.main.js');
  fs.writeFileSync(bundle, 'var a = 1;\n//# sourceMappingURL=x.map\n');
  vscodeStub.env.appRoot = root;
  return { root, bundle };
}

function context() {
  return {
    subscriptions: [],
    extensionPath: path.join(__dirname, '..'),
    globalState: {
      get: (key) => state.get(key),
      update: async (key, value) => {
        state.set(key, value);
      }
    }
  };
}

test('activate registers the commands and can patch and restore', async () => {
  const { bundle } = fakeInstall();
  const ctx = context();

  extension.activate(ctx);
  assert.deepEqual([...commands.keys()].sort(), ['equalViews.disable', 'equalViews.enable', 'equalViews.status']);

  await commands.get('equalViews.enable')();
  assert.equal(patcher.status(bundle).patched, true);
  assert.equal(state.get('equalViews.enabled'), true);
  assert.ok(messages.some((message) => message.includes('Reload')));

  await commands.get('equalViews.disable')();
  assert.equal(patcher.status(bundle).patched, false);
  assert.equal(state.get('equalViews.enabled'), false);
});

test('enable reports when it is already applied', async () => {
  const { bundle } = fakeInstall();
  const ctx = context();
  patcher.apply(bundle, '/* x */\n(function () {})();\n', false);

  messages.length = 0;
  extension.activate(ctx);
  await commands.get('equalViews.enable')();

  assert.ok(messages.some((message) => message.includes('already applied')));
});
