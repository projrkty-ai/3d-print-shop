import { describe, expect, it } from 'vitest';
import { createSlicerClient, SliceCancelledError } from './client';
import type { SliceSettings, WorkerRequest, WorkerResponse } from './protocol';

class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  sent: WorkerRequest[] = [];
  postMessage(msg: WorkerRequest) { this.sent.push(msg); }
  terminate() { this.terminated = true; }
  reply(msg: WorkerResponse) { this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>); }
}

const settings = { printer: 'p', process: 'q' } as SliceSettings;

describe('slicer worker client', () => {
  it('forwards progress and resolves with the result', async () => {
    const w = new FakeWorker();
    const client = createSlicerClient(() => w as unknown as Worker);
    const progress: number[] = [];
    const p = client.slice(new ArrayBuffer(1), 'm.stl', settings, (_, f) => progress.push(f));
    const id = w.sent[0].id;
    w.reply({ id, type: 'progress', stage: 'slicing', fraction: 0.5 });
    w.reply({ id, type: 'result', result: { time: '1h' } as never, gcode: 'G1' });
    await expect(p).resolves.toMatchObject({ result: { time: '1h' }, gcode: 'G1' });
    expect(progress).toEqual([0.5]);
  });
  it('rejects with worker errors and on cancel terminates the worker', async () => {
    const w = new FakeWorker();
    const client = createSlicerClient(() => w as unknown as Worker);
    const failing = client.slice(new ArrayBuffer(1), 'm.stl', settings, () => {});
    w.reply({ id: w.sent[0].id, type: 'error', message: 'boom' });
    await expect(failing).rejects.toThrow('boom');
    const running = client.slice(new ArrayBuffer(1), 'm.stl', settings, () => {});
    client.cancel();
    await expect(running).rejects.toBeInstanceOf(SliceCancelledError);
    expect(w.terminated).toBe(true);
  });
});
