// Run several estimates in parallel child processes.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.mjs');

export function runParallel(jobs, { concurrency = Math.max(1, os.cpus().length), onDone } = {}) {
  return new Promise((resolve) => {
    const results = new Array(jobs.length);
    let next = 0, running = 0, done = 0;
    const launch = () => {
      while (running < concurrency && next < jobs.length) {
        const i = next++;
        running++;
        const child = spawn(process.execPath, ['--max-old-space-size=4096', WORKER, JSON.stringify(jobs[i])], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', () => {
          try { results[i] = JSON.parse(out); } catch { results[i] = { error: 'worker failed' }; }
          running--; done++;
          if (onDone) onDone(i, results[i]);
          if (done === jobs.length) resolve(results); else launch();
        });
      }
    };
    if (!jobs.length) resolve([]); else launch();
  });
}
