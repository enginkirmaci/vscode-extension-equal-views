'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const patcher = require('../src/patcher');

const PAYLOAD = '/* side-car */\n(function () {\n  var CONFIG = {"targets":["sidebar"]};\n  void CONFIG;\n})();\n';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equal-views-test-'));
  const file = path.join(dir, 'workbench.desktop.main.js');
  const original = 'var a = 1;\n//# sourceMappingURL=workbench.desktop.main.js.map\n';
  fs.writeFileSync(file, original);
  return { dir, file, original };
}

test('apply appends the side-car and keeps a backup', () => {
  const { file, original } = fixture();

  const result = patcher.apply(file, PAYLOAD, false);
  assert.equal(result.changed, true);

  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.includes(patcher.START_MARKER));
  assert.ok(content.includes(patcher.END_MARKER));
  assert.ok(content.indexOf('sourceMappingURL') < content.indexOf(patcher.START_MARKER));
  assert.equal(fs.readFileSync(patcher.backupPath(file), 'utf8'), original);
});

test('apply is idempotent', () => {
  const { file } = fixture();
  patcher.apply(file, PAYLOAD, false);
  const first = fs.readFileSync(file, 'utf8');

  const second = patcher.apply(file, PAYLOAD, false);
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
});

test('force replaces an existing side-car instead of stacking it', () => {
  const { file } = fixture();
  patcher.apply(file, PAYLOAD, false);
  patcher.apply(file, '/* new side-car */\n(function () {})();\n', true);

  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content.split(patcher.START_MARKER).length, 2);
  assert.ok(content.includes('/* new side-car */'));
  assert.ok(!content.includes('/* side-car */'));
});

test('restore puts the original bundle back from the backup', () => {
  const { file, original } = fixture();
  patcher.apply(file, PAYLOAD, false);

  const result = patcher.restore(file);
  assert.equal(result.source, 'backup');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(patcher.backupPath(file)), false);
});

test('restore strips the block when the backup is gone', () => {
  const { file, original } = fixture();
  patcher.apply(file, PAYLOAD, false);
  fs.unlinkSync(patcher.backupPath(file));

  const result = patcher.restore(file);
  assert.equal(result.source, 'strip');
  assert.equal(fs.readFileSync(file, 'utf8').trimEnd(), original.trimEnd());
});

test('status reports the patch and the backup', () => {
  const { file, original } = fixture();
  const fresh = patcher.status(file);
  assert.equal(fresh.patched, false);
  assert.equal(fresh.backup, false);
  assert.equal(fresh.bytes, Buffer.byteLength(original));

  patcher.apply(file, PAYLOAD, false);
  const state = patcher.status(file);
  assert.equal(state.patched, true);
  assert.equal(state.backup, true);
  assert.ok(state.bytes > Buffer.byteLength(original));
});

test('buildPayload substitutes the config and compiles', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'media', 'equalizer.js'), 'utf8');
  const payload = patcher.buildPayload(template, { targets: ['sidebar', 'panel'], interval: 400 });

  assert.ok(payload.includes('"targets":["sidebar","panel"]'));
  assert.ok(!payload.includes(patcher.CONFIG_PLACEHOLDER));
  assert.doesNotThrow(() => new Function(payload));
});

test('buildPayload refuses a template without the placeholder', () => {
  assert.throws(() => patcher.buildPayload('(function () {})();', {}), /config placeholder/);
});

test('the equalizer template is valid JavaScript on its own', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'media', 'equalizer.js'), 'utf8');
  assert.doesNotThrow(() => new Function(template));
});
