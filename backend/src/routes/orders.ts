import { Router } from 'express';
import { t } from '../i18n';
import { ORDER_STATUSES, type OrderStatus } from '../domain/types';
import type { AdminAuth } from '../auth';
import { withoutMongoId, type Collections } from '../db';
import { HttpError, notFound } from '../http';
import { createOrder } from '../orders';
import { orderInput, orderUpdate } from '../schemas';

const MAX_LIST = 500;

export function ordersRouter(db: Collections, { requireAdmin }: AdminAuth) {
  const router = Router();

  /** Checkout: anyone can place an order; everything else is admin-only (orders hold personal data). */
  router.post('/', async (req, res) => {
    const order = await createOrder(db, orderInput.parse(req.body));
    res.status(201).location(`/api/orders/${order.id}`).json(order);
  });

  /** Newest first. Optional `?status=paid` and `?limit=50`. */
  router.get('/', requireAdmin, async (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !ORDER_STATUSES.includes(status as OrderStatus)) {
      throw new HttpError(400, t('unknownStatus', ORDER_STATUSES.join(', ')));
    }
    const limit = Math.min(MAX_LIST, Math.max(1, Number(req.query.limit) || MAX_LIST));
    const filter = status ? { status: status as OrderStatus } : {};
    res.json(await db.orders.find(filter, withoutMongoId).sort({ createdAt: -1 }).limit(limit).toArray());
  });

  router.get('/:id', requireAdmin, async (req, res) => {
    const order = await db.orders.findOne({ id: req.params.id }, withoutMongoId);
    if (!order) throw notFound('Order');
    res.json(order);
  });

  /** Status and the internal note can change; items and prices are fixed once ordered. */
  router.patch('/:id', requireAdmin, async (req, res) => {
    const changes = orderUpdate.parse(req.body);
    const order = await db.orders.findOneAndUpdate(
      { id: req.params.id },
      { $set: { ...changes, updatedAt: new Date().toISOString() } },
      { ...withoutMongoId, returnDocument: 'after' },
    );
    if (!order) throw notFound('Order');
    res.json(order);
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const { deletedCount } = await db.orders.deleteOne({ id: req.params.id });
    if (deletedCount === 0) throw notFound('Order');
    res.status(204).end();
  });

  return router;
}
