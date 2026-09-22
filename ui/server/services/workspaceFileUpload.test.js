// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createWorkspaceFileUploadHandler } from './workspaceFileUpload.js';
import { readUploadLimits } from './uploadLimits.js';

const cleanups = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });
async function fixture(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pd-workspace-test-'));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const app = express();
  app.post('/upload', createWorkspaceFileUploadHandler({ resolveProject: async () => root, getLimits: () => ({ ...readUploadLimits({}), ...overrides }) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/upload`;
  async function send(files, targetPath = '', sizes = files.map(file => file.bytes.length)) {
    const form = new FormData();
    form.append('targetPath', targetPath);
    form.append('relativePaths', JSON.stringify(files.map(file => file.name)));
    form.append('sizes', JSON.stringify(sizes));
    for (const file of files) form.append('files', new Blob([file.bytes]), path.basename(file.name));
    const response = await fetch(url, { method: 'POST', body: form });
    return { status: response.status, body: await response.json() };
  }
  async function cleanStaging() {
    await vi.waitFor(async () => expect(await fs.readdir(path.join(root, '.tmp'))).toEqual([]));
  }
  return { root, send, url, cleanStaging };
}
const file = (name, text = 'hello') => ({ name, bytes: Buffer.from(text) });

describe('workspace uploads', () => {
  it('accepts files over the old 50 MiB limit and preserves all bytes', async () => {
    const f = await fixture();
    const bytes = Buffer.alloc(64 * 1024 ** 2, 0x5a);
    const result = await f.send([{ name: 'slides.pptx', bytes }]);
    expect(result.status).toBe(200);
    expect(result.body.files[0].size).toBe(bytes.length);
    expect((await fs.readFile(path.join(f.root, 'slides.pptx'))).equals(bytes)).toBe(true);
    await f.cleanStaging();
  }, 15000);

  it('accepts 21 files, preserving nested paths and overwriting a complete file', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, 'existing.txt'), 'old');
    expect((await f.send([file('existing.txt', 'new')])).status).toBe(200);
    expect(await fs.readFile(path.join(f.root, 'existing.txt'), 'utf8')).toBe('new');
    const result = await f.send(Array.from({ length: 21 }, (_, i) => file(`folder/${i}.txt`)), 'target');
    expect(result.body.files).toHaveLength(21);
    expect(await fs.readFile(path.join(f.root, 'target/folder/20.txt'), 'utf8')).toBe('hello');
    await f.cleanStaging();
  });

  it.each([
    [{ maxFileBytes: 3 }, [file('a.txt')], 'UPLOAD_FILE_TOO_LARGE'],
    [{ maxTaskBytes: 8 }, [file('a.txt'), file('b.txt')], 'UPLOAD_TASK_TOO_LARGE'],
    [{ maxFiles: 1 }, [file('a.txt'), file('b.txt')], 'UPLOAD_TOO_MANY_FILES'],
  ])('enforces configured limits without publishing partial files (%j)', async (limits, files, code) => {
    const f = await fixture(limits);
    const result = await f.send(files);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.error.code).toBe(code);
    expect((await fs.readdir(f.root)).filter(name => name !== '.tmp')).toEqual([]);
    await f.cleanStaging();
  });

  it('rejects path traversal and symlink destinations before publishing any file', async () => {
    const f = await fixture();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pd-outside-test-'));
    cleanups.push(() => fs.rm(outside, { recursive: true, force: true }));
    await fs.symlink(outside, path.join(f.root, 'link'));
    for (const name of ['../escape.txt', 'link/escape.txt']) {
      const result = await f.send([file('good.txt'), file(name)]);
      expect(result.body.error.code).toBe('UPLOAD_INVALID_PATH');
      await expect(fs.access(path.join(f.root, 'good.txt'))).rejects.toThrow();
    }
    expect(await fs.readdir(outside)).toEqual([]);
    await f.cleanStaging();
  });

  it('rejects size mismatch and duplicate paths without changing existing files', async () => {
    const f = await fixture();
    const mismatch = await f.send([file('a.txt')], '', [999]);
    expect(mismatch.body.error.code).toBe('UPLOAD_INTEGRITY_MISMATCH');
    const duplicate = await f.send([file('a.txt'), file('a.txt')]);
    expect(duplicate.body.error.code).toBe('UPLOAD_MANIFEST_INVALID');
    await expect(fs.access(path.join(f.root, 'a.txt'))).rejects.toThrow();
    await f.cleanStaging();
  });

  it('reports exactly which files failed to save', async () => {
    const f = await fixture();
    await fs.mkdir(path.join(f.root, 'blocked.txt'));
    const result = await f.send([file('good.txt'), file('blocked.txt')]);
    expect(result.status).toBe(207);
    expect(result.body.files.map(item => item.name)).toEqual(['good.txt']);
    expect(result.body.errors.map(item => item.name)).toEqual(['blocked.txt']);
    await f.cleanStaging();
  });

  it('cleans staging on a disconnected upload and keeps the existing file intact', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, 'a.txt'), 'original');
    const req = http.request(f.url, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '10000000' } });
    req.on('error', () => {});
    req.write('--test\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: application/octet-stream\r\n\r\n');
    req.write(Buffer.alloc(128 * 1024, 65));
    await vi.waitFor(async () => expect((await fs.readdir(path.join(f.root, '.tmp'))).length).toBe(1));
    req.destroy();
    await f.cleanStaging();
    expect(await fs.readFile(path.join(f.root, 'a.txt'), 'utf8')).toBe('original');
  });
});
