import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { t } from './i18n';
import { HttpError } from './http';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Admin access is a single shared token sent as `Authorization: Bearer <token>`.
 * Enough to keep customer data and product editing private in a small shop; swap for real
 * user accounts if several people need separate access.
 */
export function adminAuth(adminToken: string) {
  const expected = digest(adminToken);

  /** Hashing first gives equal-length buffers, so the comparison is constant-time. */
  const isAdmin = (req: Request): boolean => {
    const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
    return match !== null && timingSafeEqual(digest(match[1]), expected);
  };

  const requireAdmin: RequestHandler = (req, _res, next) => {
    next(isAdmin(req) ? undefined : new HttpError(401, t('adminRequired')));
  };

  return { isAdmin, requireAdmin };
}

export type AdminAuth = ReturnType<typeof adminAuth>;
