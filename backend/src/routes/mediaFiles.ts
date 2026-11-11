import express, { Router } from 'express';
import { t } from '../i18n';
import { fileTypeFromBuffer } from 'file-type';
import type { AdminAuth } from '../auth';
import type { Storage } from '../storage';
import { HttpError, notFound } from '../http';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function mediaFilesRouter(db: Storage, { requireAdmin }: AdminAuth) {
  const router = Router();
  router.post('/', requireAdmin, express.raw({ type: 'application/octet-stream', limit: IMAGE_MAX_BYTES }), async (req, res) => {
    const data: unknown = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new HttpError(400, t('imageBody'));
    }
    let type: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
    try {
      type = await fileTypeFromBuffer(data);
    } catch (error) {
      if (!(error instanceof Error && (error.name === 'EndOfStreamError' || error.message === 'End-Of-Stream'))) throw error;
      throw new HttpError(400, t('invalidImage'));
    }
    if (!type || !ALLOWED_IMAGES.has(type.mime)) {
      throw new HttpError(400, t('imageTypes'));
    }
    const id = await db.mediaFiles.upload(`image.${type.ext}`, data, { contentType: type.mime });
    const url = `/api/media-files/${id}`;
    res.status(201).location(url).json({ url });
  });
  router.get('/:id', async (req, res) => {
    const file = await db.mediaFiles.find(String(req.params.id));
    if (!file) throw notFound('Image');
    const contentType: unknown = file.metadata.contentType;
    if (typeof contentType !== 'string' || !ALLOWED_IMAGES.has(contentType)) throw notFound('Image');
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(file.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    db.mediaFiles.openDownloadStream(file.id).on('error', (error) => res.destroy(error)).pipe(res);
  });
  return router;
}
