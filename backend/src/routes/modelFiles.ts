import express, { Router } from 'express';
import { t } from '../i18n';
import { MODEL_MAX_UPLOAD_BYTES } from '../domain/config';
import type { AdminAuth } from '../auth';
import { MODEL_FILE_URL_PREFIX, type Storage } from '../storage';
import { HttpError, notFound } from '../http';

/** 3MF is a ZIP archive; STL is either "solid …" text or a binary file with an 84-byte header. */
function looksLikeModelFile(data: Buffer): boolean {
  const isZip = data.length >= 4 && data.readUInt32LE(0) === 0x04034b50;
  return isZip || data.length >= 84;
}

/** The browser URL-encodes the name (HTTP headers can't carry e.g. "ł"); keep letters, digits and a few separators. */
export function decodeFileName(header: string | undefined): string {
  let name = header ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not URL-encoded; use as is.
  }
  return name.replace(/[^\p{L}\p{N}._\- ]+/gu, '_').slice(0, 255) || 'model';
}

export function modelFilesRouter(db: Storage, { requireAdmin }: AdminAuth) {
  const router = Router();

  /**
   * Upload an STL/3MF as the raw request body (Content-Type: application/octet-stream),
   * with the original name in `X-File-Name`. Returns the URL to store in `product.mesh.url`.
   */
  router.post(
    '/',
    requireAdmin,
    express.raw({ type: 'application/octet-stream', limit: MODEL_MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const data: unknown = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) {
        throw new HttpError(400, t('modelBody'));
      }
      if (!looksLikeModelFile(data)) throw new HttpError(400, t('invalidModel'));
      const fileName = decodeFileName(req.get('x-file-name'));

      const id = await db.modelFiles.upload(fileName, data, { uploadedAt: new Date().toISOString() });
      const url = `${MODEL_FILE_URL_PREFIX}${id}`;
      res.status(201).location(url).json({ url, fileName, sizeBytes: data.length });
    },
  );

  router.get('/:id', async (req, res) => {
    const file = await db.modelFiles.find(String(req.params.id));
    if (!file) throw notFound('Model file');
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.length),
      // A file's contents never change: replacing a model uploads a new file with a new id.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    db.modelFiles.openDownloadStream(file.id).on('error', (err) => res.destroy(err)).pipe(res);
  });

  return router;
}
