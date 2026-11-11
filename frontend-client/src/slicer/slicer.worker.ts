// Web Worker running the slicing engine off the main thread.
import { inspectModel, loadModel, runSlice } from './runSlice';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'inspect') {
      const model = loadModel(msg.file, msg.fileName, msg.plate || 1);
      scope.postMessage({ id: msg.id, type: 'inspected', info: inspectModel(model, msg.fileName) });
      return;
    }
    let last = 0;
    const result = runSlice(msg.file, msg.fileName, msg.settings, (stage, fraction) => {
      const now = Date.now();
      if (now - last < 100 && fraction < 1) return;
      last = now;
      scope.postMessage({ id: msg.id, type: 'progress', stage, fraction });
    });
    const { gcode, _diag, ...rest } = result;
    void _diag;
    scope.postMessage({ id: msg.id, type: 'result', result: rest, gcode });
  } catch (error) {
    scope.postMessage({ id: msg.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
