import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { t } from './i18n';

/** An error with an HTTP status that is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

export const notFound = (what: 'Endpoint' | 'Product' | 'Order' | 'Model file' | 'Image') => {
  const messages = {
    Endpoint: 'endpointNotFound', Product: 'productNotFound', Order: 'orderNotFound',
    'Model file': 'modelNotFound', Image: 'imageNotFound',
  } as const;
  return new HttpError(404, t(messages[what]));
};

/** Error responses are always `{ error, details? }`. Unexpected errors are logged, not leaked. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
  } else if (err instanceof z.ZodError) {
    res.status(400).json({
      error: t('invalidRequest'),
      details: err.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)),
    });
  } else if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: t('tooLarge') });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: t('invalidJson') });
  } else {
    console.error(err);
    res.status(500).json({ error: t('internalError') });
  }
};
