// Build and run a separate, per-user test application. Never touches PilotDeck's
// installation, application ID, user data, registry keys or running processes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const { prepareWindowsInstaller } = require('./prepare-windows-installer.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilotdeck-nsis-e2e-'));
  const project = path.join(root, 'desktop project');
  const payload = path.join(root, 'payload');
  const target = path.join(root, 'installed');
  const resources = path.join(project, 'resources');
  const name = `pilotdeck-installer-test-${crypto.randomUUID()}`;
  const productName = 'PilotDeck Installer Test';
  let installed = false;
  function run(exe, args) {
    const result = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 90_000 });
    assert.equal(result.status, 0, `${exe}: ${result.error || result.stderr || result.stdout || result.status}`);
  }
  try {
    fs.mkdirSync(resources, { recursive: true });
    fs.mkdirSync(path.join(payload, 'resources', 'git'), { recursive: true });
    for (const file of ['installer.nsh', 'installer-start-app.nsh', 'installer-payload.nsh'])
      fs.copyFileSync(path.join(__dirname, '..', 'resources', file), path.join(resources, file));
    fs.cpSync(path.join(__dirname, '..', 'resources', 'installer'), path.join(resources, 'installer'), { recursive: true });
    // It is deliberately not an executable: silent tests never launch the app.
    fs.writeFileSync(path.join(payload, `${productName}.exe`), 'installer fixture');
    fs.writeFileSync(path.join(payload, 'resources', 'git', '组件.txt'), 'all components retained');
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name, productName, version: '1.0.0', description: 'Installer fixture', author: 'PilotDeck' }));
    await prepareWindowsInstaller(project);
    const config = {
      appId: `cn.pilotdeck.test.${name}`, productName, electronVersion: '42.3.3',
      directories: { output: path.join(root, 'artifacts') },
      win: { signAndEditExecutable: false },
      nsis: {
        oneClick: false, perMachine: false, allowElevation: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: false, createStartMenuShortcut: false,
        include: 'resources/installer.nsh',
      },
    };
    const artifacts = await build({ projectDir: project, prepackaged: payload, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), config, publish: 'never' });
    const setup = artifacts.find(file => file.endsWith('.exe'));
    assert.ok(setup, 'compiled installer');
    for (const label of ['fresh install', 'upgrade']) {
      installed = true;
      run(setup, ['/S', '/currentuser', `/D=${target}`]);
      assert.equal(fs.readFileSync(path.join(target, 'resources', 'git', '组件.txt'), 'utf8'), 'all components retained', label);
      assert.ok(fs.existsSync(path.join(target, `Uninstall ${productName}.exe`)), 'uninstaller exists');
      assert.ok(!fs.readdirSync(root).some(file => file.startsWith('.pilotdeck-install-')), 'staging cleaned');
    }
    run(path.join(target, `Uninstall ${productName}.exe`), ['/S', '/currentuser', `_?=${target}`]);
    installed = false;
    assert.ok(!fs.existsSync(path.join(target, 'resources')), 'uninstall removed test payload');
    console.log('PASS: real NSIS build, silent installation, upgrade and uninstall with isolated app identity');
  } finally {
    if (installed && fs.existsSync(path.join(target, `Uninstall ${productName}.exe`)))
      run(path.join(target, `Uninstall ${productName}.exe`), ['/S', '/currentuser', `_?=${target}`]);
    // Absolute paths under this newly created test root only.
    fs.rmSync(root, { recursive: true, force: true });
    if (process.env.LOCALAPPDATA) fs.rmSync(path.join(process.env.LOCALAPPDATA, `${name}-updater`), { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
