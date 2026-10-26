import { Router } from 'express';
import { t } from '../i18n';
import type { Product } from '../domain/types';
import { uniqueSlug } from '../domain/utils/ids';
import { validateProduct } from '../domain/utils/validation';
import type { AdminAuth } from '../auth';
import { releaseModelFile, withoutMongoId, type Collections } from '../db';
import { HttpError, notFound } from '../http';
import { productInput, type ProductInput } from '../schemas';
import { sanitizeDescription } from '../description';

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

export function productsRouter(db: Collections, { isAdmin, requireAdmin }: AdminAuth) {
  const router = Router();

  /** Customers see published products; admins see everything. */
  router.get('/', async (req, res) => {
    const filter = isAdmin(req) ? {} : { published: true };
    res.json(await db.products.find(filter, withoutMongoId).sort({ createdAt: 1 }).toArray());
  });

  router.get('/:id', async (req, res) => {
    const product = await db.products.findOne({ id: req.params.id }, withoutMongoId);
    if (!product || (!product.published && !isAdmin(req))) throw notFound('Product');
    res.json(product);
  });

  /** The id is derived from the name and made unique; any id in the body is ignored. */
  router.post('/', requireAdmin, async (req, res) => {
    const input = productInput.parse(req.body);
    if (input.descriptionFormat === 'html') input.description = sanitizeDescription(input.description);
    assertMeshUrl(input);
    const now = new Date().toISOString();
    const takenIds = await db.products.distinct('id');
    const product: Product = { ...input, id: uniqueSlug(input.name, takenIds), createdAt: now, updatedAt: now };
    assertValid(product);
    await db.products.insertOne({ ...product });
    res.status(201).location(`/api/products/${product.id}`).json(product);
  });

  router.put('/:id', requireAdmin, async (req, res) => {
    const input = productInput.parse(req.body);
    if (input.descriptionFormat === 'html') input.description = sanitizeDescription(input.description);
    assertMeshUrl(input);
    const existing = await db.products.findOne({ id: req.params.id }, withoutMongoId);
    if (!existing) throw notFound('Product');
    const product: Product = { ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    assertValid(product);
    await db.products.replaceOne({ id: product.id }, product);
    if (existing.mesh?.url !== product.mesh?.url) await releaseModelFile(db, existing.mesh?.url);
    res.json(product);
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const deleted = await db.products.findOneAndDelete({ id: req.params.id }, withoutMongoId);
    if (!deleted) throw notFound('Product');
    await releaseModelFile(db, deleted.mesh?.url);
    res.status(204).end();
  });

  return router;
}
