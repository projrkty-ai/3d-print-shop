import express, { Router } from 'express';
import { t } from '../i18n';
import { MODEL_MAX_UPLOAD_BYTES } from '../domain/config';
import { CUSTOM_ORDER_STATUSES, type CustomOrderStatus } from '../domain/types';
import type { AdminAuth } from '../auth';
import type { Storage } from '../storage';
import { HttpError, notFound } from '../http';
import { createCustomOrder, deleteCustomOrder, roundQuote, storeCustomerFile } from '../customOrders';
import { logStatus, missingValueMessages, sendToCustomer, statusEmail } from '../logBook';
import type { Mailer } from '../mail/mailer';
import { customOrderInput, customOrderUpdate } from '../schemas';
import { logBookRouter } from './logBook';

const MAX_LIST = 500;

/** RFC 6266 attachment header that keeps non-ASCII names (e.g. "wazon-ł.stl") intact. */
function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Print requests for the customer's own models. Customers upload each file, then confirm the
 * request with their contact details; everything else, including downloading files, is admin-only.
 */
export function customOrdersRouter(db: Storage, mailer: Mailer, auth: AdminAuth) {
  const { requireAdmin } = auth;
  const router = Router();

  /**
   * Customer upload of one STL/3MF as the raw body (Content-Type: application/octet-stream), named by
   * `X-File-Name`. Returns the file id and a one-time upload key needed to include it in a request.
   */
  router.post(
    '/files',
    express.raw({ type: 'application/octet-stream', limit: MODEL_MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const data: unknown = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, t('modelBody'));
      res.status(201).json(await storeCustomerFile(db, req.get('x-file-name'), data));
    },
  );

  /** Confirms a request. Status 409 lists files that must be uploaded again (expired or already used). */
  router.post('/', async (req, res) => {
    const order = await createCustomOrder(db, customOrderInput.parse(req.body));
    res.status(201).location(`/api/custom-orders/${order.id}`).json(order);
  });

  router.use('/:id', logBookRouter(db, mailer, auth, 'customOrder'));

  /** Newest first. Optional `?status=submitted` and `?limit=50`. */
  router.get('/', requireAdmin, async (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !CUSTOM_ORDER_STATUSES.includes(status as CustomOrderStatus)) {
      throw new HttpError(400, t('unknownStatus', CUSTOM_ORDER_STATUSES.join(', ')));
    }
    const limit = Math.min(MAX_LIST, Math.max(1, Number(req.query.limit) || MAX_LIST));
    res.json(await db.customOrders.list({ status: status as CustomOrderStatus | undefined, limit }));
  });

  router.get('/:id', requireAdmin, async (req, res) => {
    const order = await db.customOrders.get(String(req.params.id));
    if (!order) throw notFound('Custom order');
    res.json(order);
  });

  /**
   * The admin's processing: status, quoted price and internal note. Files and customer details are
   * fixed. Status changes are logged; with `notify` the status email is sent (e.g. an approval
   * states the quote), after checking its required values before anything is saved.
   */
  router.patch('/:id', requireAdmin, async (req, res) => {
    const { quotedPrice, notify, note, ...rest } = customOrderUpdate.parse(req.body);
    const existing = await db.customOrders.get(String(req.params.id));
    if (!existing) throw notFound('Custom order');
    const changes = { ...rest, ...(quotedPrice !== undefined && { quotedPrice: roundQuote(quotedPrice) }) };
    const statusChanged = changes.status !== undefined && changes.status !== existing.status;
    const email = statusChanged && notify
      ? await statusEmail(db, { kind: 'customOrder', order: { ...existing, ...changes } }, changes.status!, { note })
      : null;
    if (email && email.missing.length > 0) throw new HttpError(400, t('emailMissingValues'), missingValueMessages(email.missing));
    const order = await db.customOrders.update(existing.id, { ...changes, updatedAt: new Date().toISOString() });
    if (!order) throw notFound('Custom order');
    if (statusChanged) await logStatus(db, 'customOrder', order.id, existing.status, order.status);
    if (email) await sendToCustomer(db, mailer, { kind: 'customOrder', order }, email);
    res.json(order);
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    if (!(await deleteCustomOrder(db, String(req.params.id)))) throw notFound('Custom order');
    res.status(204).end();
  });

  /** Downloads one of the request's files; only files belonging to that request are served. */
  router.get('/:id/files/:fileId', requireAdmin, async (req, res) => {
    const order = await db.customOrders.get(String(req.params.id));
    if (!order) throw notFound('Custom order');
    const entry = order.files.find((file) => file.fileId === req.params.fileId);
    const file = entry && (await db.customerFiles.find(entry.fileId));
    if (!entry || !file) throw notFound('Model file');
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.length),
      'Content-Disposition': attachment(entry.fileName),
      'X-Content-Type-Options': 'nosniff',
      // Customer files are private: never keep them in shared caches.
      'Cache-Control': 'private, no-store',
    });
    db.customerFiles.openDownloadStream(file.id).on('error', (err) => res.destroy(err)).pipe(res);
  });

  return router;
}
