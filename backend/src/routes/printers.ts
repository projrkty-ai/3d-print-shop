import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { AdminAuth } from '../auth';
import { normalizePrinterInput, validatePrinter } from '../domain/printers';
import type { Printer, PrinterModel, PrinterQueue, PrinterQueueSummary, PrinterWithModel } from '../domain/types';
import { HttpError, notFound } from '../http';
import { t } from '../i18n';
import { printerQueueEntries, QUEUE_GAP_MINUTES, queuedOrders, queueSummaries } from '../orders/printQueue';
import { printerInput } from '../schemas';
import { DuplicateNameError, type Storage } from '../storage';

/** The printer with its model's current values (so every change to a model shows on all its printers) and its queue. */
const withModel = (printer: Printer, models: PrinterModel[], queues: Map<string, PrinterQueueSummary>): PrinterWithModel => ({
  ...printer,
  model: models.find((model) => model.id === printer.modelId) ?? null,
  queue: queues.get(printer.id) ?? { length: 0, nextStart: new Date().toISOString() },
});

/**
 * The printers warehouse: the shop's printers with their unique names, where each one stands and
 * their model. Plate size, colors and slicer profiles belong to the model (`/printer-models`). Admin only.
 */
export function printersRouter(db: Storage, { requireAdmin }: AdminAuth) {
  const router = Router();
  router.use(requireAdmin);

  const find = async (id: unknown): Promise<Printer> => {
    const printer = await db.printers.get(String(id));
    if (!printer) throw notFound('Printer');
    return printer;
  };

  /** Stores the printer, turning a taken name into a 409 with the same message as a validation problem. */
  async function store(printer: Printer, save: () => Promise<void>) {
    try {
      await save();
    } catch (err) {
      if (err instanceof DuplicateNameError) throw new HttpError(409, t('printerProblems'), [t('printerNameTaken', printer.name)]);
      throw err;
    }
  }

  /** The checked input; its model must exist. */
  const parseInput = async (body: unknown) => {
    const input = normalizePrinterInput(printerInput.parse(body));
    const problems = validatePrinter(input);
    if (problems.length === 0 && !(await db.printerModels.get(input.modelId))) problems.push(t('printerModelUnknown'));
    if (problems.length > 0) throw new HttpError(400, t('printerProblems'), problems);
    return input;
  };

  const respond = async (printer: Printer) => withModel(printer, await db.printerModels.list(), await queueSummaries(db, [printer]));

  router.get('/', async (_req, res) => {
    const [printers, models] = await Promise.all([db.printers.list(), db.printerModels.list()]);
    const queues = await queueSummaries(db, printers);
    res.json(printers.map((printer) => withModel(printer, models, queues)));
  });

  router.get('/:id', async (req, res) => {
    res.json(await respond(await find(req.params.id)));
  });

  /**
   * The printer's queue: the order being printed, then the waiting orders in the order they joined,
   * each with its estimated start and end (a break of `gapMinutes` between prints). Orders join with
   * PATCH /api/orders/:id (status `queued`) and move on or leave the same way.
   */
  router.get('/:id/queue', async (req, res) => {
    const printer = await find(req.params.id);
    const body: PrinterQueue = { printer: await respond(printer), entries: await printerQueueEntries(db, printer.id), gapMinutes: QUEUE_GAP_MINUTES };
    res.json(body);
  });

  router.post('/', async (req, res) => {
    const now = new Date().toISOString();
    const printer: Printer = { id: randomUUID(), ...(await parseInput(req.body)), createdAt: now, updatedAt: now };
    await store(printer, () => db.printers.insert(printer));
    res.status(201).location(`/api/printers/${printer.id}`).json(await respond(printer));
  });

  router.put('/:id', async (req, res) => {
    const existing = await find(req.params.id);
    const printer: Printer = { ...existing, ...(await parseInput(req.body)), updatedAt: new Date().toISOString() };
    await store(printer, async () => {
      if (!(await db.printers.replace(printer))) throw notFound('Printer');
    });
    res.json(await respond(printer));
  });

  /** A printer with orders in its queue is kept until they are taken out or moved. */
  router.delete('/:id', async (req, res) => {
    const printer = await find(req.params.id);
    const queued = await queuedOrders(db, printer.id);
    if (queued.length > 0) throw new HttpError(409, t('printerHasQueue', queued.length), queued.map((order) => order.number));
    if (!(await db.printers.delete(printer.id))) throw notFound('Printer');
    res.status(204).end();
  });

  return router;
}
