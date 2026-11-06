// Starts the whole shop for local development with one command:
//   node scripts/start-local.mjs            (add --install to run `npm ci` in every application first)
//
// - Installs dependencies of applications that have none yet (`npm ci`).
// - Creates missing `.env` files from `.env.example`; the backend gets a random admin key.
// - Starts the API (SQLite by default, no database server needed), waits until it answers,
//   then starts the storefront and the administration, with labelled output.
// - Ctrl+C stops everything; if one application exits, the others are stopped too.
//
// The three applications stay independent projects: this script only runs their own npm scripts.
// Requires Node.js 22.13+ (built-in SQLite). No dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WINDOWS = process.platform === 'win32';
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);

const APPS = [
  { dir: 'backend', label: 'api', color: '35' },
  { dir: 'frontend-client', label: 'shop', color: '36', port: 5173 },
  { dir: 'frontend-admin', label: 'admin', color: '33', port: 5174 },
];

function fail(message) {
  console.error(paint('31', `\n✖ ${message}`));
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log('Usage: node scripts/start-local.mjs [--install]\n\n  --install  run `npm ci` in every application before starting');
  process.exit(0);
}
for (const arg of args) if (arg !== '--install') fail(`Unknown option ${arg}. Use --help for usage.`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  fail(`Node.js 22.13 or newer is required (built-in SQLite); this is ${process.version}.`);
}

/** Minimal .env reader: KEY=value lines, ignoring comments. */
function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]));
}

function npm(args, options) {
  // npm is a .cmd script on Windows, which Node only starts through a shell.
  return spawn('npm', args, { shell: WINDOWS, ...options });
}

// 1. Dependencies.
for (const app of APPS) {
  const cwd = join(ROOT, app.dir);
  if (!args.has('--install') && existsSync(join(cwd, 'node_modules'))) continue;
  console.log(paint('1', `Installing ${app.dir} dependencies (npm ci)…`));
  const result = spawnSync('npm', ['ci'], { cwd, stdio: 'inherit', shell: WINDOWS });
  if (result.status !== 0) fail(`npm ci failed in ${app.dir}.`);
}

// 2. Environment files.
for (const app of APPS) {
  const env = join(ROOT, app.dir, '.env');
  const example = join(ROOT, app.dir, '.env.example');
  if (existsSync(env) || !existsSync(example)) continue;
  copyFileSync(example, env);
  if (app.dir === 'backend') {
    // Never start with the placeholder key from the example.
    const key = randomBytes(18).toString('base64url');
    writeFileSync(env, readFileSync(env, 'utf8').replace(/^ADMIN_TOKEN=.*$/m, `ADMIN_TOKEN=${key}`));
  }
  console.log(`Created ${app.dir}/.env from .env.example.`);
}
const backendEnv = readEnv(join(ROOT, 'backend', '.env'));
const apiPort = Number(backendEnv.PORT || 3001);
APPS[0].port = apiPort;

// 3. Ports: a clear message beats three interleaved EADDRINUSE stack traces.
const portFree = (port) => new Promise((resolve) => {
  const server = createServer().once('error', () => resolve(false));
  server.listen(port, () => server.close(() => resolve(true)));
});
for (const app of APPS) {
  if (!(await portFree(app.port))) {
    fail(`Port ${app.port} (${app.dir}) is already in use. Stop the other process and try again.`);
  }
}

// 4. Start and supervise.
const running = new Set();
let stopping = false;

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of running) {
    try {
      if (WINDOWS) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM'); // the whole group: npm, tsx/vite and their workers
    } catch {
      // Already exited.
    }
  }
  const exit = () => process.exit(exitCode);
  if (running.size === 0) exit();
  setTimeout(exit, 5000).unref();
  const check = setInterval(() => running.size === 0 && exit(), 100);
  check.unref();
}

function start(app) {
  const child = npm(['run', 'dev'], {
    cwd: join(ROOT, app.dir),
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group on POSIX, so stopping also ends grandchildren.
    detached: !WINDOWS,
    env: { ...process.env, ...(color && { FORCE_COLOR: '1' }) },
  });
  running.add(child);
  const prefix = paint(app.color, `[${app.label}]`.padEnd(8));
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`${prefix}${line}`));
  }
  child.on('exit', (code, signal) => {
    running.delete(child);
    if (!stopping) {
      console.error(paint('31', `\n${app.dir} stopped (${signal ?? `exit code ${code}`}); stopping the other applications.`));
      stopAll(code || 1);
    }
  });
  return child;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nStopping…');
    stopAll(0);
  });
}

start(APPS[0]);
const healthUrl = `http://localhost:${apiPort}/api/health`;
const deadline = Date.now() + 60_000;
while (!stopping) {
  try {
    if ((await fetch(healthUrl)).ok) break;
  } catch {
    // Not listening yet.
  }
  if (Date.now() > deadline) {
    console.error(paint('31', `The API did not answer at ${healthUrl} within 60 seconds.`));
    stopAll(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!stopping) {
  APPS.slice(1).forEach(start);
  const database = backendEnv.DATABASE === 'mongodb' ? 'MongoDB' : 'SQLite';
  const key = backendEnv.ADMIN_TOKEN
    ? `admin key ${backendEnv.ADMIN_TOKEN} (ADMIN_TOKEN in backend/.env)`
    : 'admin key: see the temporary key in the [api] output';
  console.log([
    '',
    paint('1', 'PrintForge is starting:'),
    `  Storefront      http://localhost:5173`,
    `  Administration  http://localhost:5174/admin   ${key}`,
    `  API             http://localhost:${apiPort}/api   (${database})`,
    '  Press Ctrl+C to stop everything.',
    '',
  ].join('\n'));
}
