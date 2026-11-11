import { Router } from 'express';
import { ORDER_SOURCES, ORDER_STATUSES, type OrderSource, type OrderStatus } from '../domain/types';
import type { AdminAuth } from '../auth';
import { HttpError, notFound } from '../http';
import { t } from '../i18n';
import type { Mailer } from '../mail/mailer';
import type { ModelSearch } from '../modelSearch';
import { createOrder, deleteOrder, reviewItem, updateOrder } from '../orders';
import { downloadProjectFile } from '../orders/projectFiles';
import { itemReviewInput, orderInput, orderUpdate } from '../schemas';
import type { Storage } from '../storage';
import { logBookRouter } from './logBook';

const MAX_LIST = 500;

/** RFC 6266 attachment header that keeps non-ASCII names (e.g. "wazon-ł.stl") intact. */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Every order, whatever its models' source. Customers place orders; everything else — the list,
 * details, processing, measurements, files and log book — is admin-only and works alike for all.
 */
export function ordersRouter(db: Storage, mailer: Mailer, modelSearch: ModelSearch, auth: AdminAuth) {
  const { requireAdmin } = auth;
  const router = Router();

  /** Anyone can place an order; prices are always computed here. */
  router.post('/', async (req, res) => {
    const order = await createOrder(db, modelSearch, orderInput.parse(req.body));
    res.status(201).location(`/api/orders/${order.id}`).json(order);
  });

  router.use('/:id', logBookRouter(db, mailer, auth));

  /** Newest first. Optional `?status=received`, `?source=upload` and `?limit=50`. */
  router.get('/', requireAdmin, async (req, res) => {
    const { status, source } = req.query;
    if (status !== undefined && !ORDER_STATUSES.includes(status as OrderStatus)) {
      throw new HttpError(400, t('unknownStatus', ORDER_STATUSES.join(', ')));
    }
    if (source !== undefined && !ORDER_SOURCES.includes(source as OrderSource)) {
      throw new HttpError(400, t('invalidRequest'), [`source: ${ORDER_SOURCES.join(', ')}`]);
    }
    const limit = Math.min(MAX_LIST, Math.max(1, Number(req.query.limit) || MAX_LIST));
    res.json(await db.orders.list({ status: status as OrderStatus | undefined, source: source as OrderSource | undefined, limit }));
  });

  router.get('/:id', requireAdmin, async (req, res) => {
    const order = await db.orders.get(String(req.params.id));
    if (!order) throw notFound('Order');
    res.json(order);
  });

  /**
   * Status, internal note and — for orders that need a quote — the price. The items are fixed once
   * ordered. A status change is logged, and with `notify` the status email (with the optional
   * `note`) is sent; its required values are checked before anything is saved.
   */
  router.patch('/:id', requireAdmin, async (req, res) => {
    res.json(await updateOrder(db, mailer, String(req.params.id), orderUpdate.parse(req.body)));
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    if (!(await deleteOrder(db, String(req.params.id)))) throw notFound('Order');
    res.status(204).end();
  });

  /**
   * Takes the order out of its printer's queue: it gets back the status it had before queueing
   * (logged like any status change; with `?notify=true` the customer gets that status's email).
   */
  router.delete('/:id/print-job', requireAdmin, async (req, res) => {
    const order = await db.orders.get(String(req.params.id));
    if (!order) throw notFound('Order');
    if (!order.printJob) throw new HttpError(409, t('notInQueue'));
    res.json(await updateOrder(db, mailer, order.id, { status: order.printJob.previousStatus, notify: req.query.notify === 'true' }));
  });

  /** The shop's measurements of one copy of an item (the index in `items`), priced with the current rates. */
  router.put('/:id/items/:index/review', requireAdmin, async (req, res) => {
    const input = itemReviewInput.parse(req.body);
    const order = await db.orders.get(String(req.params.id));
    if (!order) throw notFound('Order');
    res.json(await reviewItem(db, order, Number(req.params.index), input));
  });

  /**
   * One of the order's external project files (`sourceFileId`: its id on the project's site),
   * downloaded from the site now and passed on, for the admin to slice or save. The shop keeps no
   * copy. `X-Model-Format` says whether it is an STL or 3MF (`other`: can't be sliced in the browser).
   */
  router.get('/:id/project-files/:sourceFileId', requireAdmin, async (req, res) => {
    const order = await db.orders.get(String(req.params.id));
    if (!order) throw notFound('Order');
    const file = await downloadProjectFile(modelSearch, order, String(req.params.sourceFileId));
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.data.length),
      'Content-Disposition': attachment(file.fileName),
      'X-Model-Format': file.format ?? 'other',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.end(file.data);
  });

  /** Downloads a file the customer uploaded for the order; only the order's own files are served. */
  router.get('/:id/files/:fileId', requireAdmin, async (req, res) => {
    const order = await db.orders.get(String(req.params.id));
    if (!order) throw notFound('Order');
    const model = order.items.map((item) => item.model).find((candidate) => candidate.source === 'upload' && candidate.fileId === req.params.fileId);
    const file = model?.source === 'upload' ? await db.customerFiles.find(model.fileId) : null;
    if (!model || model.source !== 'upload' || !file) throw notFound('Model file');
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.length),
      'Content-Disposition': attachment(model.fileName),
      'X-Content-Type-Options': 'nosniff',
      // Customer files are private: never keep them in shared caches.
      'Cache-Control': 'private, no-store',
    });
    db.customerFiles.openDownloadStream(file.id).on('error', (err) => res.destroy(err)).pipe(res);
  });

  return router;
}
