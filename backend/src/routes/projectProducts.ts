import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { AdminAuth } from '../auth';
import { PRINT_MATERIALS, type AdminProjectProduct, type Order, type PricingSettings, type PrintMaterial, type PrintMeasurements, type ProjectProduct, type PublicProjectProduct } from '../domain/types';
import { DEFAULT_PRICING, setPrice } from '../domain/utils/projectPricing';
import { defaultPrint, projectPrintErrors, projectPrintOptions, projectSetPricing, quoteProject } from '../domain/utils/projectPrint';
import { HttpError, notFound } from '../http';
import { t } from '../i18n';
import type { ModelSearch } from '../modelSearch';
import { createOrder } from '../orders';
import { legacyPrintOnDemandOrderInput, projectProductCreate, projectProductUpdate, projectQuoteInput } from '../schemas';
import { releaseModelFile, type Storage } from '../storage';
import { legacyPrintOnDemandOrderResponse } from './legacyOrders';

/**
 * Admins see the price of one set calculated now with the shop's rates: from the default print
 * variants at the original size for sliced products, else from the product's measurements.
 */
export const adminProjectProduct = (product: ProjectProduct, settings: PricingSettings): AdminProjectProduct =>
  ({ ...product, pricing: projectSetPricing(product, settings, defaultPrint(product)) });

/** Customers see the current price and print choices, not the shop's rates, print times, filament weights or presets. */
export function publicProjectProduct(product: ProjectProduct, settings: PricingSettings): PublicProjectProduct {
  const { measurements: _measurements, sourceOrder: _sourceOrder, mesh: _mesh, model: _model, slicing: _slicing, scaling: _scaling, ...rest } = product;
  const pricing = projectSetPricing(product, settings, defaultPrint(product));
  const printOptions = projectPrintOptions(product);
  return {
    ...rest,
    price: { total: pricing.total, handlingFee: pricing.handlingFee, setPrice: setPrice(pricing), currency: pricing.currency },
    ...(printOptions && { printOptions }),
  };
}

/** Uploaded print files must come from this API; other URLs are site paths or https. */
function assertPrintFile(product: ProjectProduct) {
  const url = product.mesh?.url;
  if (url && !/^(\/|https:\/\/)/.test(url)) throw new HttpError(400, t('productProblems'), [t('modelUrl')]);
  const problems = projectPrintErrors(product);
  if (problems.length > 0) throw new HttpError(400, t('productProblems'), problems);
}

/**
 * What one set of the product takes: every model of a project order as measured, times its copies.
 * Null until every model is measured.
 */
function orderMeasurements(order: Order): PrintMeasurements | null {
  if (order.items.some((item) => !item.review)) return null;
  const grams = new Map<PrintMaterial, number>();
  let printMinutes = 0;
  for (const { review, quantity } of order.items) {
    printMinutes += review!.printMinutes * quantity;
    for (const { key, grams: used } of review!.filaments) {
      const material = PRINT_MATERIALS.find((candidate) => candidate === key) ?? 'PLA';
      grams.set(material, (grams.get(material) ?? 0) + used * quantity);
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return { printMinutes: Math.round(printMinutes), filaments: [...grams].map(([material, used]) => ({ material, grams: round(used) })) };
}

/** Print on Demand products: reviewed projects whose price always follows the shop's current rates. */
export function projectProductsRouter(db: Storage, modelSearch: ModelSearch, { isAdmin, requireAdmin }: AdminAuth) {
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

  /** Made from an external project's order with every model measured: its project, models, settings and measurements. */
  router.post('/', requireAdmin, async (req, res) => {
    const input = projectProductCreate.parse(req.body);
    const order = await db.orders.get(input.orderId);
    if (!order) throw notFound('Order');
    if (order.source !== 'project' || !order.project) throw new HttpError(400, t('projectSourceRequired'));
    const measurements = orderMeasurements(order);
    if (!measurements) throw new HttpError(400, t('reviewRequired'));
    const { verified: _verified, sameSettingsForAll: _same, ...project } = order.project;
    const now = new Date().toISOString();
    const product: ProjectProduct = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      published: input.published,
      project,
      items: order.items.flatMap(({ model, quantity }) => (model.source === 'project'
        ? [{ file: model.file, settings: { quantity, scalePercent: model.scalePercent, filaments: model.filaments } }]
        : [])),
      measurements,
      sourceOrder: { id: order.id, number: order.number },
      createdAt: now,
      updatedAt: now,
    };
    await db.projectProducts.insert(product);
    res.status(201).location(`/api/project-products/${product.id}`).json(adminProjectProduct(product, await rates()));
  });

  /**
   * Title, description, publication, the measurements, and the print file with its scaling and
   * sliced print variants can change (and with them the price).
   */
  router.patch('/:id', requireAdmin, async (req, res) => {
    const changes = projectProductUpdate.parse(req.body);
    const existing = await db.projectProducts.get(String(req.params.id));
    if (!existing) throw notFound('Project product');
    const product: ProjectProduct = { ...existing, ...changes, updatedAt: new Date().toISOString() };
    assertPrintFile(product);
    await db.projectProducts.replace(product);
    if (existing.mesh?.url !== product.mesh?.url) await releaseModelFile(db, existing.mesh?.url);
    res.json(adminProjectProduct(product, await rates()));
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const existing = await db.projectProducts.get(String(req.params.id));
    if (!existing || !(await db.projectProducts.delete(existing.id))) throw notFound('Project product');
    await releaseModelFile(db, existing.mesh?.url);
    res.status(204).end();
  });

  /** The price of an order before it is placed: the chosen print variants, scale and number of sets. */
  router.post('/:id/quote', async (req, res) => {
    const input = projectQuoteInput.parse(req.body);
    const product = await db.projectProducts.get(String(req.params.id));
    if (!product || (!product.published && !isAdmin(req))) throw notFound('Project product');
    const quote = quoteProject(product, await rates(), input.sets, input.print);
    if (typeof quote === 'string') throw new HttpError(400, t('invalidRequest'), [quote]);
    res.json(quote);
  });

  /**
   * Where storefronts of the versions with separate order kinds ordered a product. Kept so such a
   * storefront can still order; use `POST /api/orders` with `source: "printOnDemand"`.
   */
  router.post('/:id/orders', async (req, res) => {
    const order = await createOrder(db, modelSearch, legacyPrintOnDemandOrderInput(String(req.params.id)).parse(req.body));
    res.status(201).location(`/api/orders/${order.id}`).json(legacyPrintOnDemandOrderResponse(order));
  });

  return router;
}
