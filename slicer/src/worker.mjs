// Child process entry: run one estimate and print JSON (used for parallel runs).
import { estimateFile } from './node.mjs';
const opts = JSON.parse(process.argv[2]);
try {
  const r = estimateFile(opts);
  process.stdout.write(JSON.stringify(r));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }));
  process.exitCode = 1;
}
