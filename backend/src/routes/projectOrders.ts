import { Router } from 'express';
import { t } from '../i18n';
import { PROJECT_ORDER_STATUSES, type ProjectOrderStatus } from '../domain/types';
import type { AdminAuth } from '../auth';
import type { Storage } from '../storage';
import { HttpError, notFound } from '../http';
import type { ModelSearch } from '../modelSearch';
import { createProjectOrder } from '../projectOrders';
import { projectOrderInput, projectOrderUpdate, projectReviewInput } from '../schemas';
import { DEFAULT_PRICING, priceProject } from '../domain/utils/projectPricing';

const MAX_LIST = 500;

/** Requests to print projects from external model sites; placed by customers, reviewed by admins. */
export function projectOrdersRouter(db: Storage, modelSearch: ModelSearch, { requireAdmin }: AdminAuth) {
  const router = Router();

  router.post('/', async (req, res) => {
    const order = await createProjectOrder(db, modelSearch, projectOrderInput.parse(req.body));
    res.status(201).location(`/api/project-orders/${order.id}`).json(order);
  });

  /** Newest first. Optional `?status=new` and `?limit=50`. */
  router.get('/', requireAdmin, async (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !PROJECT_ORDER_STATUSES.includes(status as ProjectOrderStatus)) {
      throw new HttpError(400, t('unknownStatus', PROJECT_ORDER_STATUSES.join(', ')));
    }
    const limit = Math.min(MAX_LIST, Math.max(1, Number(req.query.limit) || MAX_LIST));
    res.json(await db.projectOrders.list({ status: status as ProjectOrderStatus | undefined, limit }));
  });

  router.get('/:id', requireAdmin, async (req, res) => {
    const order = await db.projectOrders.get(String(req.params.id));
    if (!order) throw notFound('Project order');
    res.json(order);
  });

  /** Status and the internal note can change; the project, files and preferences are fixed once ordered. */
  router.patch('/:id', requireAdmin, async (req, res) => {
    const changes = projectOrderUpdate.parse(req.body);
    const order = await db.projectOrders.update(String(req.params.id), { ...changes, updatedAt: new Date().toISOString() });
    if (!order) throw notFound('Project order');
    res.json(order);
  });

  /**
   * The admin's quote for an order that needs one: print time and filament used, priced with the shop's
   * current rates and stored as the order's price entry. Saving again reprices it.
   */
  router.put('/:id/review', requireAdmin, async (req, res) => {
    const input = projectReviewInput.parse(req.body);
    const existing = await db.projectOrders.get(String(req.params.id));
    if (!existing) throw notFound('Project order');
    // A fixed-price order keeps the price it was placed with.
    if (!existing.requiresQuote) throw new HttpError(409, t('priceFixed'));
    const settings = (await db.settings.getPricing()) ?? DEFAULT_PRICING;
    const now = new Date().toISOString();
    const order = await db.projectOrders.update(String(req.params.id), {
      review: { ...priceProject(input, settings), reviewedAt: now }, updatedAt: now,
    });
    if (!order) throw notFound('Project order');
    res.json(order);
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    if (!(await db.projectOrders.delete(String(req.params.id)))) throw notFound('Project order');
    res.status(204).end();
  });

  return router;
}
