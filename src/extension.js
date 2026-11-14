'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const patcher = require('./patcher');

const ENABLED_KEY = 'equalViews.enabled';
const CONFIG_FILE = 'equalizer.js';
const REGIONS = ['sidebar', 'secondarySideBar', 'panel'];

function bundleFile() {
  return patcher.bundlePath(vscode.env.appRoot);
}

function payloadFor(context) {
  const template = fs.readFileSync(path.join(context.extensionPath, 'media', CONFIG_FILE), 'utf8');
  const configured = vscode.workspace.getConfiguration('equalViews').get('targets', ['sidebar']);
  const targets = Array.isArray(configured) ? configured.filter((name) => REGIONS.includes(name)) : ['sidebar'];
  return patcher.buildPayload(template, {
    targets: targets.length ? targets : ['sidebar'],
    interval: 400,
    debug: false
  });
}

async function reload(message) {
  const choice = await vscode.window.showInformationMessage(message, 'Reload Window');
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

async function enable(context) {
  if (vscode.env.uiKind === vscode.UIKind.Web) {
    vscode.window.showErrorMessage('Equal Views needs a desktop installation; the web client has no workbench bundle to patch.');
    return;
  }

  const file = bundleFile();
  if (!fs.existsSync(file)) {
    vscode.window.showErrorMessage(`Equal Views: could not find ${file}.`);
    return;
  }

  try {
    const result = patcher.apply(file, payloadFor(context), false);
    await context.globalState.update(ENABLED_KEY, true);
    if (result.changed) {
      await reload('Equal Views is applied. Reload the window to activate it.');
    } else {
      vscode.window.showInformationMessage('Equal Views is already applied.');
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Equal Views: ${err.message}`);
  }
}

async function disable(context) {
  const file = bundleFile();
  if (!fs.existsSync(file)) {
    vscode.window.showErrorMessage(`Equal Views: could not find ${file}.`);
    return;
  }

  try {
    const result = patcher.restore(file);
    await context.globalState.update(ENABLED_KEY, false);
    if (result.changed) {
      await reload('Equal Views is removed. Reload the window to finish.');
    } else {
      vscode.window.showInformationMessage('Equal Views was not applied; nothing to restore.');
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Equal Views: ${err.message}`);
  }
}

function showStatus() {
  const file = bundleFile();
  const state = patcher.status(file);
  if (!state.exists) {
    vscode.window.showErrorMessage(`Equal Views: could not find ${file}.`);
    return;
  }
  const megabytes = (state.bytes / 1024 / 1024).toFixed(1);
  vscode.window.showInformationMessage(
    [
      `Equal Views: ${state.patched ? 'applied' : 'not applied'}`,
      `backup: ${state.backup ? 'yes' : 'no'}`,
      `bundle: ${megabytes} MB`,
      `vscode: ${vscode.version}`
    ].join(' · ')
  );
}

async function repatch(context) {
  if (!context.globalState.get(ENABLED_KEY)) {
    return;
  }
  if (vscode.workspace.getConfiguration('equalViews').get('autoRepatch', true) === false) {
    return;
  }

  const file = bundleFile();
  if (!fs.existsSync(file) || patcher.status(file).patched) {
    return;
  }

  try {
    patcher.apply(file, payloadFor(context), false);
    await reload('Equal Views: the VS Code bundle was updated, so the side-car was re-applied. Reload the window to activate it.');
  } catch (err) {
    vscode.window.showErrorMessage(`Equal Views could not re-apply itself: ${err.message}`);
  }
}

async function refresh(context, reason) {
  if (!context.globalState.get(ENABLED_KEY)) {
    return;
  }
  const file = bundleFile();
  if (!patcher.status(file).patched) {
    return;
  }
  try {
    patcher.apply(file, payloadFor(context), true);
    vscode.window.showInformationMessage(`Equal Views: ${reason}. Reload the window to apply it.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Equal Views: ${err.message}`);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('equalViews.enable', () => enable(context)),
    vscode.commands.registerCommand('equalViews.disable', () => disable(context)),
    vscode.commands.registerCommand('equalViews.status', () => showStatus()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('equalViews.targets')) {
        void refresh(context, 'targets changed');
      }
    })
  );

  void repatch(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
