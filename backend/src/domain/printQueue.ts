import type { PrintJob } from './types';

/** The break between two prints on one printer (removing the print, checking and preparing the printer). */
export const QUEUE_GAP_MINUTES = 60;

const MINUTE = 60_000;

/** A print's place in time. */
export interface QueueSlot<T> {
  item: T;
  start: Date;
  end: Date;
}

/**
 * The order a printer works through its queue: what is printing first (by start), then the waiting
 * orders in the order they joined.
 */
export function queueOrder<T extends { printJob: PrintJob }>(items: T[]): T[] {
  const printing = items.filter((item) => item.printJob.startedAt !== null)
    .sort((a, b) => a.printJob.startedAt!.localeCompare(b.printJob.startedAt!));
  const waiting = items.filter((item) => item.printJob.startedAt === null)
    .sort((a, b) => a.printJob.queuedAt.localeCompare(b.printJob.queuedAt));
  return [...printing, ...waiting];
}

/**
 * Estimated times of a printer's queue (see `queueOrder`): a print that has started ends after its
 * print time (or now, when it takes longer than estimated); the next one starts `gapMinutes` after
 * the previous one ends, and never before `now`. The first waiting order of an idle printer starts now.
 */
export function scheduleQueue<T extends { printJob: PrintJob }>(items: T[], now: Date, gapMinutes = QUEUE_GAP_MINUTES): QueueSlot<T>[] {
  let next: number | null = null;
  return queueOrder(items).map((item) => {
    const { startedAt, printMinutes } = item.printJob;
    const start = startedAt !== null ? Date.parse(startedAt) : Math.max(next ?? now.getTime(), now.getTime());
    const end = Math.max(start + printMinutes * MINUTE, startedAt !== null ? now.getTime() : 0);
    next = end + gapMinutes * MINUTE;
    return { item, start: new Date(start), end: new Date(end) };
  });
}

/** When an order queued now would start on a printer with this queue. */
export function nextQueueStart(slots: QueueSlot<unknown>[], now: Date, gapMinutes = QUEUE_GAP_MINUTES): Date {
  const last = slots.at(-1);
  return last ? new Date(Math.max(last.end.getTime() + gapMinutes * MINUTE, now.getTime())) : now;
}
