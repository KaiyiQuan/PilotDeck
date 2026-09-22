// Runs the real Electron main process against an isolated, tiny HTTP runtime.
// Native dialogs are answered by the fixture; no real user data or tasks are used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

if (process.platform !== 'win32') throw new Error('Run this check on Windows.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilotdeck-tray-test-'));
try {
  const desktop = path.resolve(__dirname, '..');
  const runtime = path.join(root, 'runtime');
  const utils = path.join(runtime, 'ui', 'server', 'utils');
  fs.mkdirSync(utils, { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'));
  fs.mkdirSync(path.join(root, 'resources', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'pilotdeck-tray-test', version: '1.0.0', main: 'fixture.cjs' }));
  fs.writeFileSync(path.join(runtime, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'windows-tray.cjs'), path.join(root, 'fixture.cjs'));
  fs.copyFileSync(path.join(desktop, 'resources', 'icons', 'icon.ico'), path.join(root, 'resources', 'icons', 'icon.ico'));
  for (const file of fs.readdirSync(path.join(desktop, 'src')).filter(name => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(desktop, 'src', file), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(path.join(root, 'dist', file.replace(/\.ts$/, '.js')), compiled);
  }
  for (const file of ['processTree.js', 'processIdentity.cjs', 'processScope.cjs', 'processGuardian.cjs', 'processJob.ps1']) {
    fs.copyFileSync(path.resolve(desktop, '../../ui/server/utils', file), path.join(utils, file));
  }
  fs.writeFileSync(path.join(runtime, 'ui', 'server', 'index.js'), `
    import http from 'node:http';
    import fs from 'node:fs';
    fs.writeFileSync(process.env.PILOTDECK_TRAY_TEST_PID, String(process.pid));
    http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Tray test</title><p>Isolated runtime</p>'); }).listen(Number(process.env.SERVER_PORT), '127.0.0.1');
  `);
  const env = {
    ...process.env,
    PILOTDECK_TRAY_TEST_UPDATER: path.dirname(require.resolve('electron-updater/package.json')),
    PILOTDECK_DESKTOP_RUNTIME_ROOT: runtime,
    PILOTDECK_DESKTOP_NODE: process.execPath,
    PILOT_HOME: path.join(root, 'home'),
    PILOTDECK_TRAY_TEST_PID: path.join(root, 'runtime.pid'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [root], { env, windowsHide: true, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.ok(fs.existsSync(path.join(root, 'passed')), 'real app reached graceful shutdown');
  console.log('PASS: real Electron close/hide, restore, single-instance activation, localized cancel/confirm, and managed runtime shutdown');
} finally {
  // Only the absolute directory allocated above; never the real app profile.
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
