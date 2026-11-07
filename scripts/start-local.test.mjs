import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

test('SIGINT handler stops all launched application process trees', { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'printforge-launcher-test-'));
  const ports = await Promise.all([freePort(), freePort(), freePort()]);
  const serverPids = new Set();
  let launcher;
  let output = '';
  try {
    await mkdir(join(fixture, 'scripts'));
    const source = await readFile(new URL('./start-local.mjs', import.meta.url), 'utf8');
    await writeFile(join(fixture, 'scripts', 'start-local.mjs'), `${source
      .replace('port: 5173', `port: ${ports[1]}`)
      .replace('port: 5174', `port: ${ports[2]}`)}
process.on('message', (message) => { if (message === 'interrupt') process.emit('SIGINT'); });
`);
    for (const [index, dir] of ['backend', 'frontend-client', 'frontend-admin'].entries()) {
      const cwd = join(fixture, dir);
      await mkdir(join(cwd, 'node_modules'), { recursive: true });
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs' } }));
      await writeFile(join(cwd, 'server.cjs'), `require('node:http').createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: process.pid }));
      }).listen(${ports[index]});`);
    }
    await writeFile(join(fixture, 'backend', '.env'), `PORT=${ports[0]}\n`);
    launcher = spawn(process.execPath, [join(fixture, 'scripts', 'start-local.mjs')], {
      cwd: fixture, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    launcher.stdout.on('data', (data) => { output += data; });
    launcher.stderr.on('data', (data) => { output += data; });
    const exited = new Promise((resolve, reject) => {
      launcher.once('error', reject);
      launcher.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await waitFor(async () => {
      if (launcher.exitCode !== null) throw new Error(`Launcher exited early: ${output}`);
      for (const port of ports) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`);
          serverPids.add((await response.json()).pid);
        } catch {
          return false;
        }
      }
      return true;
    }, 'all three fixture applications');

    launcher.send('interrupt');
    const result = await Promise.race([exited, delay(10_000).then(() => { throw new Error(`Launcher did not stop: ${output}`); })]);
    assert.deepEqual(result, { code: 0, signal: null }, output);
    await waitFor(async () => {
      const responses = await Promise.all(ports.map((port) =>
        fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)));
      return responses.every((responded) => !responded);
    }, 'all fixture servers to stop');
  } finally {
    if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(launcher.pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-launcher.pid, 'SIGKILL');
    }
    for (const pid of serverPids) {
      try { process.kill(pid, 0); } catch { continue; }
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      else process.kill(pid, 'SIGKILL');
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
