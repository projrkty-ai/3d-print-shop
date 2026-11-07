import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { AdminAuth } from '../auth';
import type { AdminProjectProduct, PricingSettings, ProjectProduct, PublicProjectProduct } from '../domain/types';
import { DEFAULT_PRICING, priceProject, setPrice } from '../domain/utils/projectPricing';
import { HttpError, notFound } from '../http';
import { t } from '../i18n';
import { createProductOrder } from '../projectOrders';
import { projectProductCreate, projectProductOrderInput, projectProductUpdate } from '../schemas';
import type { Storage } from '../storage';

/** Admins see the price calculated now from the product's measurements and the shop's rates. */
export const adminProjectProduct = (product: ProjectProduct, settings: PricingSettings): AdminProjectProduct =>
  ({ ...product, pricing: priceProject(product.measurements, settings) });

/** Customers see the current price, not the shop's hourly rate, print times or filament weights. */
export function publicProjectProduct({ measurements, sourceOrder: _sourceOrder, ...product }: ProjectProduct, settings: PricingSettings): PublicProjectProduct {
  const pricing = priceProject(measurements, settings);
  return { ...product, price: { total: pricing.total, handlingFee: pricing.handlingFee, setPrice: setPrice(pricing), currency: pricing.currency } };
}

/** Ready-to-print products: reviewed projects whose price always follows the shop's current rates. */
export function projectProductsRouter(db: Storage, { isAdmin, requireAdmin }: AdminAuth) {
  const router = Router();
  const rates = async () => (await db.settings.getPricing()) ?? DEFAULT_PRICING;

  router.get('/', async (req, res) => {
    const admin = isAdmin(req);
    const [products, settings] = await Promise.all([db.projectProducts.list({ publishedOnly: !admin }), rates()]);
    res.json(products.map((product) => (admin ? adminProjectProduct(product, settings) : publicProjectProduct(product, settings))));
  });

  router.get('/:id', async (req, res) => {
    const product = await db.projectProducts.get(String(req.params.id));
    const admin = isAdmin(req);
    if (!product || (!product.published && !admin)) throw notFound('Project product');
    const settings = await rates();
    res.json(admin ? adminProjectProduct(product, settings) : publicProjectProduct(product, settings));
  });

  /** Made from a reviewed project order: its project, models, settings and measurements. */
  router.post('/', requireAdmin, async (req, res) => {
    const input = projectProductCreate.parse(req.body);
    const order = await db.projectOrders.get(input.orderId);
    if (!order) throw notFound('Project order');
    if (!order.review) throw new HttpError(400, t('reviewRequired'));
    const now = new Date().toISOString();
    const product: ProjectProduct = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      published: input.published,
      project: order.project,
      items: order.items,
      measurements: {
        printMinutes: order.review.printMinutes,
        filaments: order.review.filaments.map(({ material, grams }) => ({ material, grams })),
      },
      sourceOrder: { id: order.id, number: order.number },
      createdAt: now,
      updatedAt: now,
    };
    await db.projectProducts.insert(product);
    res.status(201).location(`/api/project-products/${product.id}`).json(adminProjectProduct(product, await rates()));
  });

  /** Title, description, publication and the measurements (and with them the price) can change. */
  router.patch('/:id', requireAdmin, async (req, res) => {
    const changes = projectProductUpdate.parse(req.body);
    const existing = await db.projectProducts.get(String(req.params.id));
    if (!existing) throw notFound('Project product');
    const product: ProjectProduct = { ...existing, ...changes, updatedAt: new Date().toISOString() };
    await db.projectProducts.replace(product);
    res.json(adminProjectProduct(product, await rates()));
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    if (!(await db.projectProducts.delete(String(req.params.id)))) throw notFound('Project product');
    res.status(204).end();
  });

  /** Customers order a published product: at the current price, or as a quote request when they change a material. */
  router.post('/:id/orders', async (req, res) => {
    const input = projectProductOrderInput.parse(req.body);
    const product = await db.projectProducts.get(String(req.params.id));
    if (!product || !product.published) throw notFound('Project product');
    const order = await createProductOrder(db, product, input, await rates());
    res.status(201).location(`/api/project-orders/${order.id}`).json(order);
  });

  return router;
}
