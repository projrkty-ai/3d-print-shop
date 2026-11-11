import express, { Router } from 'express';
import { MODEL_MAX_UPLOAD_BYTES } from '../domain/config';
import { HttpError } from '../http';
import { t } from '../i18n';
import { estimateUploads, storeCustomerFile } from '../orders/upload';
import { uploadEstimateInput } from '../schemas';
import type { Storage } from '../storage';

/**
 * Customers' own model files, before they are ordered. Each file is uploaded on its own; the order
 * then names the files with the keys their uploads returned.
 */
export function uploadsRouter(db: Storage) {
  const router = Router();

  /**
   * One STL/3MF as the raw body (Content-Type: application/octet-stream), named by `X-File-Name`.
   * Returns the file id and a one-time upload key needed to include it in an order.
   */
  router.post('/', express.raw({ type: 'application/octet-stream', limit: MODEL_MAX_UPLOAD_BYTES }), async (req, res) => {
    const data: unknown = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, t('modelBody'));
    res.status(201).json(await storeCustomerFile(db, req.get('x-file-name'), data));
  });

  /**
   * Prices the customer's own slicing of their models (print time and grams per color part of one
   * copy) with the chosen filaments and the shop's rates: the estimate shown before ordering.
   */
  router.post('/estimate', async (req, res) => {
    res.json(await estimateUploads(db, uploadEstimateInput.parse(req.body)));
  });

  return router;
}
