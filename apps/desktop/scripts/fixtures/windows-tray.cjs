const electron = require('electron');
const { app, BrowserWindow, Menu } = electron;
const Module = require('node:module');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });

app.setPath('userData', path.join(__dirname, 'profile'));
app.setName('PilotDeck Tray Test');
fs.mkdirSync(app.getPath('userData'), { recursive: true });
const appearance = path.join(app.getPath('userData'), 'appearance.json');
if (!fs.existsSync(appearance)) fs.writeFileSync(appearance, '{"language":"zh-CN","themeMode":"system"}');

if (process.argv.includes('--tray-second-instance')) {
  assert.equal(app.requestSingleInstanceLock(), false, 'second process must not start a runtime');
  app.quit();
} else {
  let tray, menu, runtimePid;
  let completedAssertions = false;
  const dialogs = [];
  const nativeDialog = new Proxy(electron.dialog, {
    get(target, key) {
      if (key === 'showMessageBox') return (owner, options) => new Promise(resolve => dialogs.push({ owner, options, resolve }));
      if (key === 'showErrorBox') return (title, message) => { console.error(title, message); app.exit(1); };
      return target[key];
    },
  });
  const api = new Proxy(electron, {
    get(target, key) {
      if (key === 'dialog') return nativeDialog;
      if (key === 'Tray') return function (icon) {
        tray = new electron.Tray(icon);
        const setMenu = tray.setContextMenu.bind(tray);
        tray.setContextMenu = value => { menu = value; setMenu(value); };
        return tray;
      };
      return target[key];
    },
  });
  const load = Module._load;
  Module._load = function (id, parent, ...rest) {
    if (id === 'electron') return api;
    if (id === 'electron-updater' || id.startsWith('electron-updater/'))
      id = path.join(process.env.PILOTDECK_TRAY_TEST_UPDATER, id.slice('electron-updater'.length));
    return load.call(this, id, parent, ...rest);
  };
  require('./dist/main.js');
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(predicate, description) {
    const deadline = Date.now() + 90_000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, description);
      await pause(30);
    }
  }
  app.on('will-quit', () => {
    // Registered after main's tray disposer and after managed process cleanup.
    assert.equal(completedAssertions, true, 'app must not exit before the checks finish');
    assert.equal(tray.isDestroyed(), true);
    assert.equal(alive(runtimePid), false, 'quit must stop the real runtime process');
    fs.writeFileSync(path.join(__dirname, 'passed'), 'ok');
  });
  app.whenReady().then(async () => {
    await until(() => BrowserWindow.getAllWindows().length > 0, 'startup window exists');
    const window = BrowserWindow.getAllWindows()[0];
    window.close();
    assert.equal(window.isDestroyed(), false);
    await until(() => window.webContents.getURL().startsWith('http://127.0.0.1:'), 'runtime page loads');
    await until(() => !window.webContents.isLoading(), 'runtime page finishes loading');
    assert.equal(window.isVisible(), false, 'finishing startup must not reopen a window the user closed');
    tray.emit('click');
    await until(() => window.isVisible(), 'restore after background startup');
    const url = window.webContents.getURL();
    runtimePid = Number(fs.readFileSync(process.env.PILOTDECK_TRAY_TEST_PID, 'utf8'));
    await window.webContents.executeJavaScript('window.unsentDraft = "preserve this"');
    assert.ok(tray && !tray.isDestroyed());
    assert.equal(menu.items[0].label, '打开主界面');

    window.close();
    await until(() => !window.isVisible(), 'close hides the window');
    assert.equal(window.isDestroyed(), false);
    assert.equal(alive(runtimePid), true);
    assert.equal((await fetch(url)).status, 200, 'runtime responds while window is hidden');
    menu.items[0].click();
    await until(() => window.isVisible(), 'tray menu restores the window');
    assert.equal(await window.webContents.executeJavaScript('window.unsentDraft'), 'preserve this');
    window.minimize();
    await until(() => window.isMinimized(), 'window minimizes');
    tray.emit('click');
    await until(() => !window.isMinimized() && window.isVisible(), 'tray click restores minimized window');

    window.close();
    const second = spawn(process.execPath, [__dirname, '--tray-second-instance'], { windowsHide: true, stdio: 'pipe' });
    const secondExit = new Promise((resolve, reject) => { second.once('error', reject); second.once('exit', resolve); });
    assert.equal(await secondExit, 0);
    await until(() => window.isVisible(), 'second instance restores the original window');
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.equal(Number(fs.readFileSync(process.env.PILOTDECK_TRAY_TEST_PID, 'utf8')), runtimePid);

    window.close();
    menu.items[2].click();
    menu.items[2].click();
    await until(() => dialogs.length === 1, 'one quit dialog opens');
    assert.equal(window.isVisible(), true);
    assert.equal(dialogs[0].owner, window);
    assert.equal(dialogs[0].options.defaultId, 0);
    assert.deepEqual(dialogs[0].options.buttons, ['取消', '退出程序']);
    dialogs[0].resolve({ response: 0 });
    await pause(50);
    assert.equal(alive(runtimePid), true);
    window.close();
    await until(() => !window.isVisible(), 'cancel leaves close-to-tray working');
    tray.emit('double-click');
    await until(() => window.isVisible(), 'double click restores the window');
    await window.webContents.executeJavaScript('window.pilotdeckDesktop.setAppearance({language:"en",themeMode:"system"})');
    assert.equal(menu.items[0].label, 'Open main window');
    Menu.getApplicationMenu().items.find(item => item.label === '&File').submenu.items[0].click();
    await until(() => dialogs.length === 2, 'File > Exit uses the same confirmation');
    assert.deepEqual(dialogs[1].options.buttons, ['Cancel', 'Quit']);
    completedAssertions = true;
    dialogs[1].resolve({ response: 1 });
  }).catch(error => { console.error(error); app.exit(1); });
}
