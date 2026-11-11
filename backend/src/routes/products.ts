import { Router } from 'express';
import { t } from '../i18n';
import type { Product } from '../domain/types';
import { uniqueSlug } from '../domain/utils/ids';
import { validateProduct } from '../domain/utils/validation';
import type { AdminAuth } from '../auth';
import { releaseModelFile, type Storage } from '../storage';
import { HttpError, notFound } from '../http';
import { productInput, type ProductInput } from '../schemas';
import { sanitizeDescription } from '../description';
import { catalogPricing, publicCatalogPricing } from '../domain/utils/pricing';
import { publicSlicing, variantPrices, variantScalePrices } from '../domain/utils/printVariants';
import type { CatalogPricing } from '../domain/types';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';

function assertValid(product: Product) {
  const problems = validateProduct(product);
  if (problems.length > 0) throw new HttpError(400, t('productProblems'), problems);
}

/** Uploaded model files must come from this API; other mesh URLs (e.g. bundled demos) are site paths or https. */
function assertMeshUrl(input: ProductInput) {
  const url = input.mesh?.url;
  if (url && !/^(\/|https:\/\/)/.test(url)) {
    throw new HttpError(400, t('productProblems'), [t('modelUrl')]);
  }
}

/**
 * A product as returned by the API, with the current catalog rates and the original-size price of
 * every offered print variant. Customers don't receive the shop's rates, slicer presets or
 * measurements of the variants.
 */
function productResponse(product: Product, pricing: CatalogPricing, admin: boolean) {
  const priced = { ...product, catalogPricing: pricing };
  const scalePrices = product.slicing ? variantScalePrices(priced) : {};
  const prices = product.slicing ? {
    variantPrices: variantPrices(priced),
    ...(Object.keys(scalePrices).length > 0 && { variantScalePrices: scalePrices }),
  } : {};
  if (admin) return { ...product, catalogPricing: { ...pricing, ...prices } };
  const { slicing: _private, ...rest } = product;
  const slicing = publicSlicing(product);
  return { ...rest, ...(slicing && { slicing }), catalogPricing: { ...publicCatalogPricing(pricing), ...prices } };
}

export function productsRouter(db: Storage, { isAdmin, requireAdmin }: AdminAuth) {
  const router = Router();
  const currentPricing = async () => catalogPricing((await db.settings.getPricing()) ?? DEFAULT_PRICING);

  /** Customers see published products; admins see everything. */
  router.get('/', async (req, res) => {
    const [products, pricing] = await Promise.all([
      db.products.list({ publishedOnly: !isAdmin(req) }), currentPricing(),
    ]);
    res.json(products.map((product) => productResponse(product, pricing, isAdmin(req))));
  });

  router.get('/:id', async (req, res) => {
    const product = await db.products.get(String(req.params.id));
    if (!product || (!product.published && !isAdmin(req))) throw notFound('Product');
    res.json(productResponse(product, await currentPricing(), isAdmin(req)));
  });

  /** The id is derived from the name and made unique; any id in the body is ignored. */
  router.post('/', requireAdmin, async (req, res) => {
    const input = productInput.parse(req.body);
    if (input.descriptionFormat === 'html') input.description = sanitizeDescription(input.description);
    assertMeshUrl(input);
    const now = new Date().toISOString();
    const takenIds = await db.products.ids();
    const product: Product = { ...input, id: uniqueSlug(input.name, takenIds), createdAt: now, updatedAt: now };
    assertValid(product);
    await db.products.insert(product);
    res.status(201).location(`/api/products/${product.id}`).json(productResponse(product, await currentPricing(), true));
  });

  router.put('/:id', requireAdmin, async (req, res) => {
    const input = productInput.parse(req.body);
    if (input.descriptionFormat === 'html') input.description = sanitizeDescription(input.description);
    assertMeshUrl(input);
    const existing = await db.products.get(String(req.params.id));
    if (!existing) throw notFound('Product');
    const product: Product = { ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    assertValid(product);
    if (!(await db.products.replace(product))) throw notFound('Product');
    if (existing.mesh?.url !== product.mesh?.url) await releaseModelFile(db, existing.mesh?.url);
    res.json(productResponse(product, await currentPricing(), true));
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const deleted = await db.products.delete(String(req.params.id));
    if (!deleted) throw notFound('Product');
    await releaseModelFile(db, deleted.mesh?.url);
    res.status(204).end();
  });

  return router;
}
