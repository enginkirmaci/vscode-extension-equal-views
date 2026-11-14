'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const START_MARKER = '/* ===== equal-views:start ===== */';
const END_MARKER = '/* ===== equal-views:end ===== */';
const CONFIG_PLACEHOLDER = '/*__EQUAL_VIEWS_CONFIG__*/ null';

function bundlePath(appRoot) {
  return path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
}

function backupPath(file) {
  return `${file}.equal-views.bak`;
}

function isPatched(content) {
  return content.indexOf(START_MARKER) !== -1;
}

/**
 * Removes the side-car block from a bundle. Everything before the block and
 * everything after it are kept, so a bundle that gained content after our
 * block still restores cleanly.
 */
function stripPatch(content) {
  const start = content.indexOf(START_MARKER);
  if (start === -1) {
    return content;
  }
  const end = content.indexOf(END_MARKER, start);
  const tail = end === -1 ? '' : content.slice(end + END_MARKER.length);
  return `${content.slice(0, start)}${tail}`.replace(/\s*$/, '\n');
}

function buildPayload(template, config) {
  if (template.indexOf(CONFIG_PLACEHOLDER) === -1) {
    throw new Error('equalizer template is missing its config placeholder');
  }
  const json = JSON.stringify(config || {});
  return template.replace(CONFIG_PLACEHOLDER, () => json);
}

function checkSyntax(code, label) {
  try {
    // Compiles the source without running it; a typo must never reach the bundle.
    // eslint-disable-next-line no-new-func
    new Function(code);
  } catch (err) {
    throw new Error(`${label} does not compile: ${err.message}`);
  }
}

function isPermissionError(err) {
  return Boolean(err) && (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EROFS');
}

function asRoot(args) {
  try {
    execFileSync('sudo', ['-n'].concat(args), { stdio: 'pipe' });
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).trim() : err.message;
    throw new Error(
      `cannot write to the VS Code installation (${detail}). ` +
        'Run the command from a terminal that can write there, or install VS Code for the current user.'
    );
  }
}

function copyFile(source, target) {
  try {
    fs.copyFileSync(source, target);
  } catch (err) {
    if (!isPermissionError(err)) {
      throw err;
    }
    asRoot(['cp', '-p', source, target]);
  }
}

function removeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }
    if (!isPermissionError(err)) {
      throw err;
    }
    asRoot(['rm', '-f', file]);
  }
}

function writeFile(file, data) {
  try {
    fs.writeFileSync(file, data);
    return 'direct';
  } catch (err) {
    if (!isPermissionError(err)) {
      throw err;
    }
  }

  const temp = path.join(os.tmpdir(), `equal-views-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(temp, data, 'utf8');
  try {
    asRoot(['install', '-m', '664', temp, file]);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (err) {
      // best effort
    }
  }
  return 'sudo';
}

function status(file) {
  if (!fs.existsSync(file)) {
    return { exists: false, patched: false, backup: false, bytes: 0 };
  }
  const content = fs.readFileSync(file, 'utf8');
  return {
    exists: true,
    patched: isPatched(content),
    backup: fs.existsSync(backupPath(file)),
    bytes: Buffer.byteLength(content)
  };
}

/**
 * Appends the side-car to the workbench bundle. With `force`, an existing
 * side-car is replaced (used when the configuration changed).
 */
function apply(file, payload, force) {
  const original = fs.readFileSync(file, 'utf8');
  if (isPatched(original) && !force) {
    return { changed: false, reason: 'already-patched' };
  }

  checkSyntax(payload, 'the equalizer payload');

  const backup = backupPath(file);
  if (!fs.existsSync(backup)) {
    copyFile(file, backup);
  }

  const patched = `${stripPatch(original)}\n${START_MARKER}\n${payload}\n${END_MARKER}\n`;
  writeFile(file, patched);

  const written = fs.readFileSync(file, 'utf8');
  if (!isPatched(written) || written.split(START_MARKER).length !== 2 || !written.trimEnd().endsWith(END_MARKER)) {
    throw new Error('the patched bundle did not verify; nothing was changed on purpose');
  }

  return { changed: true, backup };
}

function restore(file) {
  const backup = backupPath(file);
  if (fs.existsSync(backup)) {
    copyFile(backup, file);
    removeFile(backup);
    return { changed: true, source: 'backup' };
  }

  const current = fs.readFileSync(file, 'utf8');
  if (!isPatched(current)) {
    return { changed: false, source: 'none' };
  }
  writeFile(file, stripPatch(current));
  return { changed: true, source: 'strip' };
}

module.exports = {
  START_MARKER,
  END_MARKER,
  CONFIG_PLACEHOLDER,
  bundlePath,
  backupPath,
  isPatched,
  stripPatch,
  buildPayload,
  status,
  apply,
  restore
};
