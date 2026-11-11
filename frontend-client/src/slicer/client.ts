import type { EstimateResult } from './engine/index.mjs';
import type { ModelInfo, SliceSettings, WorkerRequest, WorkerResponse } from './protocol';

export interface SliceOutput {
  result: EstimateResult;
  gcode?: string;
}

/** Talks to the slicing Web Worker; a cancelled run terminates the worker. */
export interface SlicerClient {
  inspect(file: ArrayBuffer, fileName: string, plate: number): Promise<ModelInfo>;
  slice(file: ArrayBuffer, fileName: string, settings: SliceSettings, onProgress: (stage: string, fraction: number) => void): Promise<SliceOutput>;
  cancel(): void;
  dispose(): void;
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

type Pending = {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  onProgress?: (stage: string, fraction: number) => void;
};

export class SliceCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SliceCancelledError';
  }
}

export function createSlicerClient(
  makeWorker: () => Worker = () => new Worker(new URL('./slicer.worker.ts', import.meta.url), { type: 'module' }),
): SlicerClient {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (error: Error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  const getWorker = () => {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') { p.onProgress?.(msg.stage, msg.fraction); return; }
      pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else if (msg.type === 'inspected') (p.resolve as (v: ModelInfo) => void)(msg.info);
      else (p.resolve as (v: SliceOutput) => void)({ result: msg.result, gcode: msg.gcode });
    };
    w.onerror = (event) => {
      failAll(new Error(event.message || 'Slicer worker failed'));
      w.terminate();
      if (worker === w) worker = null;
    };
    worker = w;
    return w;
  };
  const send = <T,>(request: WithoutId<WorkerRequest>, onProgress?: (stage: string, fraction: number) => void) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (value: never) => void, reject, onProgress });
      // the file is copied (not transferred) so that the caller can slice it again
      getWorker().postMessage({ ...request, id } as WorkerRequest);
    });

  return {
    inspect: (file, fileName, plate) => send<ModelInfo>({ type: 'inspect', file, fileName, plate }),
    slice: (file, fileName, settings, onProgress) => send<SliceOutput>({ type: 'slice', file, fileName, settings }, onProgress),
    cancel: () => {
      if (worker) { worker.terminate(); worker = null; }
      failAll(new SliceCancelledError());
    },
    dispose: () => {
      if (worker) { worker.terminate(); worker = null; }
      pending.clear();
    },
  };
}
