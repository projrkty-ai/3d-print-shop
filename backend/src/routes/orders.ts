import { Router } from 'express';
import { t } from '../i18n';
import { ORDER_STATUSES, type OrderStatus } from '../domain/types';
import type { AdminAuth } from '../auth';
import type { Storage } from '../storage';
import { HttpError, notFound } from '../http';
import { createOrder } from '../orders';
import { orderInput, orderUpdate } from '../schemas';

const MAX_LIST = 500;

export function ordersRouter(db: Storage, { requireAdmin }: AdminAuth) {
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
    res.json(await db.orders.list({ status: status as OrderStatus | undefined, limit }));
  });

  router.get('/:id', requireAdmin, async (req, res) => {
    const order = await db.orders.get(String(req.params.id));
    if (!order) throw notFound('Order');
    res.json(order);
  });

  /** Status and the internal note can change; items and prices are fixed once ordered. */
  router.patch('/:id', requireAdmin, async (req, res) => {
    const changes = orderUpdate.parse(req.body);
    const order = await db.orders.update(String(req.params.id), { ...changes, updatedAt: new Date().toISOString() });
    if (!order) throw notFound('Order');
    res.json(order);
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    if (!(await db.orders.delete(String(req.params.id)))) throw notFound('Order');
    res.status(204).end();
  });

  return router;
}
