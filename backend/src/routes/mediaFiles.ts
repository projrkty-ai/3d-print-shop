import express, { Router } from 'express';
import { t } from '../i18n';
import { fileTypeFromBuffer } from 'file-type';
import { ObjectId } from 'mongodb';
import type { AdminAuth } from '../auth';
import type { Collections } from '../db';
import { HttpError, notFound } from '../http';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function mediaFilesRouter(db: Collections, { requireAdmin }: AdminAuth) {
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
    const upload = db.mediaFiles.openUploadStream(`image.${type.ext}`, { metadata: { contentType: type.mime } });
    await new Promise<void>((resolve, reject) => {
      upload.once('finish', resolve);
      upload.once('error', reject);
      upload.end(data);
    });
    const url = `/api/media-files/${upload.id.toHexString()}`;
    res.status(201).location(url).json({ url });
  });
  router.get('/:id', async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) throw notFound('Image');
    const id = new ObjectId(req.params.id);
    const [file] = await db.mediaFiles.find({ _id: id }).toArray();
    if (!file) throw notFound('Image');
    const contentType: unknown = file.metadata?.contentType;
    if (typeof contentType !== 'string' || !ALLOWED_IMAGES.has(contentType)) throw notFound('Image');
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(file.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    db.mediaFiles.openDownloadStream(id).on('error', (error) => res.destroy(error)).pipe(res);
  });
  return router;
}
