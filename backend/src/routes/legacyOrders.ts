import { Router } from 'express';
import type { Order } from '../domain/types';
import type { ModelSearch } from '../modelSearch';
import { createOrder } from '../orders';
import { estimateUploads } from '../orders/upload';
import { legacyProjectOrderInput, legacyUploadOrderInput, uploadEstimateInput } from '../schemas';
import type { Storage } from '../storage';
import { uploadsRouter } from './uploads';

/**
 * The unified order plus the fields an earlier storefront reads from its confirmation: a print
 * request's `files` (with `parts` estimates) and `estimatedPrice`.
 */
export function legacyUploadOrderResponse(order: Order) {
  const files = order.items.flatMap(({ model, quantity, estimate }) => {
    if (model.source !== 'upload') return [];
    const { source: _source, ...file } = model;
    return [{
      ...file,
      quantity,
      ...(estimate && { estimate: { printMinutes: estimate.printMinutes, parts: estimate.filaments, unitPrice: estimate.unitPrice } }),
    }];
  });
  return { ...order, files, ...(order.price.estimated !== null && { estimatedPrice: order.price.estimated }), quotedPrice: order.price.total };
}

/** The unified order plus what an earlier storefront reads after ordering a Print on Demand product. */
export function legacyPrintOnDemandOrderResponse(order: Order) {
  const requiresQuote = order.price.mode === 'quote';
  return {
    ...order,
    requiresQuote,
    ...(!requiresQuote && order.price.total !== null && { review: { total: order.price.total, handlingFee: order.price.handlingFee } }),
  };
}

/**
 * Where storefronts of the versions with separate order kinds placed print requests and project
 * orders. Kept so such a storefront (e.g. still open in a browser) can place orders; they become
 * ordinary orders; the response is the unified order with the fields those storefronts read. Use `POST /api/orders` and `/api/uploads`.
 */
export function legacyCustomOrdersRouter(db: Storage, modelSearch: ModelSearch) {
  const router = Router();
  const uploads = uploadsRouter(db);
  router.use('/files', uploads);
  /** Answers both the current `items` and the former `files`. */
  router.post('/estimate', async (req, res) => {
    const estimate = await estimateUploads(db, uploadEstimateInput.parse(req.body));
    res.json({ ...estimate, files: estimate.items });
  });
  router.post('/', async (req, res) => {
    const order = await createOrder(db, modelSearch, legacyUploadOrderInput.parse(req.body));
    res.status(201).location(`/api/orders/${order.id}`).json(legacyUploadOrderResponse(order));
  });
  return router;
}

export function legacyProjectOrdersRouter(db: Storage, modelSearch: ModelSearch) {
  const router = Router();
  router.post('/', async (req, res) => {
    const order = await createOrder(db, modelSearch, legacyProjectOrderInput.parse(req.body));
    res.status(201).location(`/api/orders/${order.id}`).json(order);
  });
  return router;
}
