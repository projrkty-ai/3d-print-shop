import express, { Router, type Request } from 'express';
import type { AdminAuth } from '../auth';
import { HttpError, notFound } from '../http';
import { t } from '../i18n';
import { importEml, sendToCustomer, statusEmail } from '../logBook';
import { planPrintJob } from '../orders/printQueue';
import { EML_MAX_BYTES } from '../mail/eml';
import type { Mailer } from '../mail/mailer';
import { customerMessageInput, emailPreviewInput } from '../schemas';
import type { Storage } from '../storage';

/**
 * An order's log book, mounted below `/orders/:id` (admin only): the entries, a preview of status
 * emails, messages to the customer and imported .eml files — the same for every order.
 */
export function logBookRouter(db: Storage, mailer: Mailer, { requireAdmin }: AdminAuth) {
  const router = Router({ mergeParams: true });
  // Guarded per route: a router-wide check would also catch unrelated paths below `/:id`.

  const load = async (req: Request) => {
    const order = await db.orders.get(String(req.params.id));
    if (!order) throw notFound('Order');
    return order;
  };

  /** Newest first. */
  router.get('/log', requireAdmin, async (req, res) => {
    const order = await load(req);
    res.json(await db.logBook.list(order.id));
  });

  /**
   * The email a status change would send, rendered from the admin's unsaved form (`note`, `price`
   * and, for `queued`, the printer in `queue` with the estimated start); `required` lists the
   * template's required variables and `missing` those that must be filled in first (e.g. the print
   * times while no printer is chosen).
   */
  router.post('/email-preview', requireAdmin, async (req, res) => {
    const { queue, ...input } = emailPreviewInput.parse(req.body);
    const order = await load(req);
    let printJob = order.printJob ?? null;
    try {
      printJob = await planPrintJob(db, order, input.status, queue, new Date());
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      printJob = null;
    }
    res.json({ to: order.customer.email, ...(await statusEmail(db, { ...order, printJob }, input.status, input)) });
  });

  /** A message written by the admin; 201 with the log entry, which records a failed delivery too. */
  router.post('/messages', requireAdmin, async (req, res) => {
    const { subject, body } = customerMessageInput.parse(req.body);
    const order = await load(req);
    res.status(201).json(await sendToCustomer(db, mailer, order, { subject, body, template: null }));
  });

  /** An .eml file as the raw body (e.g. the customer's reply saved from a mail program). */
  router.post(
    '/log/eml',
    requireAdmin,
    express.raw({ type: ['message/rfc822', 'application/octet-stream'], limit: EML_MAX_BYTES }),
    async (req, res) => {
      const data: unknown = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, t('emlBody'));
      const order = await load(req);
      res.status(201).json(await importEml(db, order, data));
    },
  );

  /** The original imported .eml file. */
  router.get('/log/:entryId/eml', requireAdmin, async (req, res) => {
    const order = await load(req);
    const entry = await db.logBook.get(order.id, String(req.params.entryId));
    const file = entry?.type === 'emailImported' ? await db.mailFiles.find(entry.emlFileId) : null;
    if (!entry || !file) throw notFound('Log entry');
    res.set({
      'Content-Type': 'message/rfc822',
      'Content-Length': String(file.length),
      'Content-Disposition': `attachment; filename="${order.number}-${entry.createdAt.slice(0, 10)}.eml"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    db.mailFiles.openDownloadStream(file.id).on('error', (err) => res.destroy(err)).pipe(res);
  });

  return router;
}
