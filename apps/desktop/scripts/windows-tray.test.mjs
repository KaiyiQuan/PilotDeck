import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(name) {
  const source = fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, require);
  return mod.exports;
}
const { createWindowsTray } = load('windowsTray');
const { buildApplicationMenu } = load('applicationMenu');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ failTray = false } = {}) {
  const state = { quitting: false, chinese: true, quits: 0, restores: 0, dialogs: [], errors: [] };
  const window = Object.assign(new EventEmitter(), {
    visible: true, destroyed: false, hide() { this.visible = false; }, isDestroyed() { return this.destroyed; },
  });
  const tray = Object.assign(new EventEmitter(), {
    destroyed: false, menu: [], isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; },
    setToolTip(text) { this.tooltip = text; }, setContextMenu(menu) { this.menu = menu; },
  });
  const controller = createWindowsTray({
    createTray: () => { if (failTray) throw new Error('tray unavailable'); return tray; },
    buildMenu: items => items, getWindow: () => window,
    restoreWindow: async () => { state.restores++; window.visible = true; },
    isQuitting: () => state.quitting, isChinese: () => state.chinese,
    showDialog: (owner, options) => new Promise((resolve, reject) => { state.dialogs.push({ owner, options, resolve, reject }); }),
    quit: () => { state.quits++; state.quitting = true; },
    reportError: error => state.errors.push(error),
  });
  controller.attachWindow(window);
  function close() {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    window.emit('close', event);
    return event.prevented;
  }
  return { state, window, tray, controller, close };
}

test('close keeps the window alive in the tray; all open actions restore it without quitting', async () => {
  const { state, window, tray, controller, close } = setup();
  assert.equal(controller.available(), true);
  assert.equal(tray.tooltip, 'PilotDeck');
  assert.deepEqual(tray.menu.filter(item => item.label).map(item => item.label), ['打开主界面', '退出程序']);
  for (const action of [() => tray.menu[0].click(), () => tray.emit('click'), () => tray.emit('double-click')]) {
    assert.equal(close(), true);
    assert.equal(window.visible, false);
    assert.equal(window.destroyed, false);
    action();
    await tick();
    assert.equal(window.visible, true);
  }
  assert.equal(state.restores, 3);
  assert.equal(state.quits, 0);
  assert.equal(state.dialogs.length, 0);
});

test('tray quit restores the main window, defaults to cancel, and never stacks dialogs', async () => {
  const { state, window, tray, close } = setup();
  close();
  tray.menu[2].click();
  tray.menu[2].click();
  await tick();
  assert.equal(window.visible, true);
  assert.equal(state.dialogs.length, 1);
  assert.equal(state.dialogs[0].owner, window);
  assert.deepEqual(state.dialogs[0].options.buttons, ['取消', '退出程序']);
  assert.equal(state.dialogs[0].options.cancelId, 0);
  assert.equal(state.dialogs[0].options.defaultId, 0);
  assert.equal(close(), true);
  assert.equal(window.visible, true, 'outstanding dialog parent must not be hidden');
  state.dialogs[0].resolve({ response: 0 });
  await tick();
  assert.equal(state.quits, 0);
  assert.equal(tray.destroyed, false);
  assert.equal(close(), true, 'cancelled quit must leave background behavior working');
});

test('only confirmation quits; allow close during cleanup but retain tray until actual exit', async () => {
  const { state, tray, controller, close } = setup();
  const pending = controller.requestQuit();
  await tick();
  assert.equal(state.quits, 0);
  state.dialogs[0].resolve({ response: 1 });
  await pending;
  assert.equal(state.quits, 1);
  assert.equal(close(), false);
  assert.equal(tray.destroyed, false, 'keep recovery access until will-quit');
  state.quitting = false; // Runtime shutdown failed; app can remain running.
  assert.equal(close(), true);
  controller.dispose();
  assert.equal(tray.destroyed, true);
  assert.equal(controller.available(), false);
  await controller.requestQuit();
  assert.equal(state.dialogs.length, 1);
});

test('update/system quit bypasses hiding and confirmation, including an outstanding dialog', async () => {
  const { state, window, controller, close } = setup();
  const pending = controller.requestQuit();
  await tick();
  state.quitting = true;
  assert.equal(close(), false);
  state.dialogs[0].resolve({ response: 1 });
  await pending;
  await controller.requestQuit();
  window.visible = false;
  await controller.open();
  assert.equal(window.visible, false);
  assert.equal(state.quits, 0, 'do not duplicate the update quit');
  assert.equal(state.dialogs.length, 1);
});

test('tray failure never hides the only accessible window', () => {
  const { state, window, controller, close } = setup({ failTray: true });
  assert.equal(controller.available(), false);
  assert.equal(close(), false);
  assert.equal(window.visible, true);
  assert.equal(state.errors.length, 1);
});

test('dialog failure is recoverable and language changes update both menu and confirmation', async () => {
  const { state, tray, controller } = setup();
  const first = controller.requestQuit();
  await tick();
  state.dialogs[0].reject(new Error('dialog failed'));
  await first;
  assert.equal(state.quits, 0);
  assert.equal(state.errors.length, 1);
  state.chinese = false;
  controller.refreshMenu();
  assert.equal(tray.menu[0].label, 'Open main window');
  const second = controller.requestQuit();
  await tick();
  assert.deepEqual(state.dialogs[1].options.buttons, ['Cancel', 'Quit']);
  state.dialogs[1].resolve({ response: 0 });
  await second;
});

test('File > Exit shares confirmation on Windows; other platforms retain native quit roles', () => {
  let requests = 0;
  for (const platform of ['win32', 'darwin', 'linux']) {
    const sections = buildApplicationMenu(platform, 'en', () => requests++);
    const items = sections.flatMap(section => section.submenu);
    if (platform === 'win32') {
      assert.equal(items.some(item => item.role === 'quit'), false);
      items.find(item => item.label === 'Exit').click();
      assert.equal(requests, 1);
      assert.equal(items.find(item => item.label === 'Close Window').role, 'close');
    } else assert.equal(items.some(item => item.role === 'quit'), true);
  }
});
