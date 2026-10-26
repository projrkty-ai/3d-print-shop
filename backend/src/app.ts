import express, { Router } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { adminAuth } from './auth';
import { t } from './i18n';
import type { Collections } from './db';
import { errorHandler, HttpError, notFound } from './http';
import { modelFilesRouter } from './routes/modelFiles';
import { ordersRouter } from './routes/orders';
import { productsRouter } from './routes/products';
import { mediaFilesRouter } from './routes/mediaFiles';

interface AppOptions {
  db: Collections;
  adminToken: string;
  allowedOrigins?: string[];
}

export function createApp({ db, adminToken, allowedOrigins = [] }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  const auth = adminAuth(adminToken);
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new HttpError(403, t('originForbidden')));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-File-Name'],
  }));
  app.use('/models', express.static(fileURLToPath(new URL('../public/models', import.meta.url))));

  const api = Router();
  // Orders can carry a few customer texture images (downscaled data URLs).
  api.use(express.json({ limit: '10mb' }));
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  /** Lets the admin UI check a token without loading any data. */
  api.get('/admin/session', auth.requireAdmin, (_req, res) => {
    res.status(204).end();
  });
  api.use('/products', productsRouter(db, auth));
  api.use('/orders', ordersRouter(db, auth));
  api.use('/model-files', modelFilesRouter(db, auth));
  api.use('/media-files', mediaFilesRouter(db, auth));
  api.use(() => {
    throw notFound('Endpoint');
  });
  api.use(errorHandler);
  app.use('/api', api);

  app.use((_req, _res, next) => next(notFound('Endpoint')));
  app.use(errorHandler);

  return app;
}
