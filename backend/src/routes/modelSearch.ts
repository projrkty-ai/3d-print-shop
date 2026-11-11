import { Router } from 'express';
import { z } from 'zod';
import { t } from '../i18n';
import { HttpError } from '../http';
import { MODEL_SOURCES, SourceUnavailableError, type ModelSearch, type ModelSearchPage, type ProjectRef, type SearchCursor } from '../modelSearch';

export const QUERY_MIN_LENGTH = 2;
export const QUERY_MAX_LENGTH = 100;

const searchQuery = z.string().trim().min(QUERY_MIN_LENGTH).max(QUERY_MAX_LENGTH);

const sourcePosition = z.object({
  page: z.number().int().min(1).max(10_000).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  cursor: z.string().min(1).max(1000).optional(),
  variant: z.number().int().min(0).max(9).optional(),
}).strict();
const searchCursor = z.object(Object.fromEntries(MODEL_SOURCES.map((source) => [source, sourcePosition.optional()])))
  .strict()
  .refine((cursor) => Object.keys(cursor).length > 0);

const projectRef = z.object({ source: z.enum(MODEL_SOURCES), id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

/** The next-page cursor travels as opaque base64url JSON; customers can edit it, so it is validated strictly. */
export const encodeCursor = (cursor: SearchCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decodeCursor(value: unknown): SearchCursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== 'string' || value.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    return searchCursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))) as SearchCursor;
  } catch {
    throw new HttpError(400, t('searchCursor'));
  }
}

/** JSON answer: one page of unified results plus `nextCursor` for "load more" (null at the end). */
export type ModelSearchResponse = Omit<ModelSearchPage, 'next'> & { nextCursor: string | null };

/** Public: customers search Thingiverse, Printables and MakerWorld through the shop's server. */
export function modelSearchRouter(modelSearch: ModelSearch) {
  const router = Router();
  /** A project with its files, by `?url=` (a link to its model page) or `?source=&id=`. */
  router.get('/project', async (req, res) => {
    const { url, source, id } = req.query;
    let ref: ProjectRef | null;
    if (typeof url === 'string') {
      ref = url.length <= 2000 ? modelSearch.projectFromUrl(url) : null;
      if (!ref) throw new HttpError(400, t('projectUrl'));
    } else {
      const parsed = projectRef.safeParse({ source, id });
      if (!parsed.success) throw new HttpError(400, t('projectRef'));
      ref = parsed.data;
    }
    try {
      res.set('Cache-Control', 'private, max-age=300').json(await modelSearch.project(ref));
    } catch (error) {
      if (error instanceof SourceUnavailableError) throw new HttpError(404, t('projectSourceUnavailable'));
      throw new HttpError(502, t('projectUnavailable'));
    }
  });

  router.get('/', async (req, res) => {
    const query = searchQuery.safeParse(typeof req.query.q === 'string' ? req.query.q.replace(/\s+/g, ' ') : '');
    if (!query.success) throw new HttpError(400, t('searchQuery', QUERY_MIN_LENGTH, QUERY_MAX_LENGTH));
    const cursor = decodeCursor(req.query.cursor);
    const { next, ...page } = await modelSearch.search(query.data, cursor);
    const body: ModelSearchResponse = { ...page, nextCursor: next ? encodeCursor(next) : null };
    res.set('Cache-Control', 'private, max-age=300').json(body);
  });
  return router;
}
