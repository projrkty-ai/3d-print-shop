import { describe, expect, it } from 'vitest';
import { nextQueueStart, queueOrder, scheduleQueue } from './printQueue';
import type { PrintJob } from './types';

const now = new Date('2026-11-10T10:00:00.000Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const job = (id: string, printMinutes: number, queuedMinutes: number, startedMinutes: number | null = null) => ({
  id,
  printJob: {
    printerId: 'p1', printerName: 'U1-01', queuedAt: at(queuedMinutes), printMinutes, startedAt: startedMinutes === null ? null : at(startedMinutes),
    estimatedStart: at(0), previousStatus: 'paid',
  } satisfies PrintJob,
});
const times = (slots: ReturnType<typeof scheduleQueue<ReturnType<typeof job>>>) =>
  slots.map(({ item, start, end }) => [item.id, start.toISOString(), end.toISOString()]);

describe('print queue schedule', () => {
  it('prints the queue in the order it was joined, with an hour between prints, starting now when idle', () => {
    const slots = scheduleQueue([job('b', 90, -10), job('a', 120, -30), job('c', 30, -5)], now);
    expect(times(slots)).toEqual([
      ['a', at(0), at(120)],
      ['b', at(180), at(270)],
      ['c', at(330), at(360)],
    ]);
    expect(nextQueueStart(slots, now).toISOString()).toBe(at(420));
    expect(nextQueueStart([], now)).toEqual(now);
  });

  it('puts the print that started first, and lets a print that takes longer than estimated end now', () => {
    const running = job('c', 60, -5, -20);
    expect(queueOrder([job('a', 10, -30), running]).map((item) => item.id)).toEqual(['c', 'a']);
    expect(times(scheduleQueue([job('a', 10, -30), running], now))).toEqual([['c', at(-20), at(40)], ['a', at(100), at(110)]]);
    const overdue = job('d', 30, -200, -100);
    expect(times(scheduleQueue([overdue, job('a', 10, -30)], now))).toEqual([['d', at(-100), at(0)], ['a', at(60), at(70)]]);
    // A custom break.
    expect(times(scheduleQueue([job('a', 10, -30), job('b', 10, -20)], now, 15))).toEqual([['a', at(0), at(10)], ['b', at(25), at(35)]]);
  });
});
