import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { encodeCursor } from '../routes/modelSearch';
import type { Storage } from '../storage';
import { openTestStorage } from '../storage/testStorage';
import { dispositionFileName, fetchBinary, FileTooLargeError, imageUrl, plainText, siteLink, UpstreamError } from './normalize';
import {
  createModelSearch, FileNotListedError, makerWorldProvider, modelSearchFromEnv, parseModelSources, printablesProvider, SourceUnavailableError,
  thingiverseProvider, type ModelSearch, type ModelSearchPage, type ModelSearchProvider, type ModelSearchResult, type ProjectDetails,
  type ProviderPage, type SourcePosition,
} from '.';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A fetch stand-in that answers by URL and records every request. */
function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const options = (position: SourcePosition | null = null, limit = 12) => ({ limit, signal: AbortSignal.timeout(5_000), position });
const graphql = (init: RequestInit) => JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };

const thingHit = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Thing ${id}`,
  url: `https://api.thingiverse.com/things/${id}`,
  public_url: `https://www.thingiverse.com/thing:${id}`,
  thumbnail: `https://cdn.thingiverse.com/assets/${id}/thumb.jpg`,
  preview_image: `https://cdn.thingiverse.com/assets/${id}/preview.jpg`,
  creator: { id: 7, name: 'maker_anna', public_url: 'https://www.thingiverse.com/maker_anna' },
  like_count: 12,
  is_nsfw: false,
  ...overrides,
});

describe('text and URL normalization', () => {
  it('turns HTML and Markdown descriptions into short plain text', () => {
    expect(plainText('<p>Hello&nbsp;<b>world</b> &amp; friends</p><p>Second</p><script>alert(1)</script>'))
      .toBe('Hello world & friends Second');
    expect(plainText('# Title\n\n**Bold** text with a [link](https://x.example) ![img](https://x.example/a.png)\n- item'))
      .toBe('Bold text with a link item');
    expect(plainText('<h2>About</h2><p>A sturdy hook.</p>')).toBe('A sturdy hook.');
    expect(plainText('## Only a heading')).toBe('Only a heading');
    expect(plainText('Tom &lt;3 &#x1F600; &#169;')).toBe('Tom <3 😀 ©');
    expect(plainText(undefined)).toBe('');
    expect(plainText(42)).toBe('');
    const long = plainText('word '.repeat(200), 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith('word…')).toBe(true);
  });

  it('accepts only HTTPS links on the source domain and HTTPS images', () => {
    const domains = ['thingiverse.com'];
    expect(siteLink('https://www.thingiverse.com/thing:1', domains)).toBe('https://www.thingiverse.com/thing:1');
    expect(siteLink('https://thingiverse.com/thing:1', domains)).toBe('https://thingiverse.com/thing:1');
    for (const bad of ['javascript:alert(1)', 'http://www.thingiverse.com/thing:1', 'https://evilthingiverse.com/x',
      'https://thingiverse.com.evil.example/x', 'https://user:pw@thingiverse.com/', '/thing:1', 42, null]) {
      expect(siteLink(bad, domains), String(bad)).toBeNull();
    }
    expect(imageUrl('//cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(imageUrl('http://cdn.example.com/a.jpg')).toBeNull();
    expect(imageUrl('data:image/png;base64,AAAA')).toBeNull();
  });
});

describe('Thingiverse', () => {
  it('searches with the app token, reports the total and reads missing descriptions from each thing, once', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.pathname.startsWith('/search/')) {
        return Response.json({ total: 1843, hits: [thingHit(1), thingHit(2, { description: 'Given in the hit' }), thingHit(3, { is_nsfw: true })] });
      }
      if (url.pathname === '/things/1') return Response.json({ id: 1, description: '<p>A <em>sturdy</em> hook.</p>' });
      return new Response('not found', { status: 404 });
    });
    const provider = thingiverseProvider({ token: 'secret-app-token', fetch });
    const page = await provider.search('wall hook', options(null, 3));

    const search = calls[0];
    expect(search.url.origin + search.url.pathname).toBe('https://api.thingiverse.com/search/wall%20hook/');
    expect(search.url.searchParams.get('type')).toBe('things');
    expect(search.url.searchParams.get('per_page')).toBe('3');
    expect(search.url.searchParams.get('page')).toBe('1');
    expect((search.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-app-token');
    expect(page.total).toBe(1843);
    expect(page.next).toEqual({ page: 2 });
    expect(page.results).toEqual<ModelSearchResult[]>([
      {
        source: 'thingiverse', id: '1', title: 'Thing 1', description: 'A sturdy hook.',
        thumbnailUrl: 'https://cdn.thingiverse.com/assets/1/preview.jpg', url: 'https://www.thingiverse.com/thing:1', author: 'maker_anna',
      },
      {
        source: 'thingiverse', id: '2', title: 'Thing 2', description: 'Given in the hit',
        thumbnailUrl: 'https://cdn.thingiverse.com/assets/2/preview.jpg', url: 'https://www.thingiverse.com/thing:2', author: 'maker_anna',
      },
    ]);
    expect(calls.map((call) => call.url.pathname)).toEqual(['/search/wall%20hook/', '/things/1']);

    await provider.search('wall hook', options(null, 3));
    expect(calls.filter((call) => call.url.pathname === '/things/1')).toHaveLength(1);
  });

  it('requests later pages and stops at the reported total', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ total: 5, hits: [thingHit(4, { description: 'x' }), thingHit(5, { description: 'y' })] }));
    const page = await thingiverseProvider({ token: 't', fetch }).search('cup', options({ page: 2 }, 3));
    expect(calls[0].url.searchParams.get('page')).toBe('2');
    expect(page).toMatchObject({ total: 5, next: null });
  });

  it('keeps models whose details fail, replaces foreign links and accepts a bare array without a total', async () => {
    const { fetch } = fakeFetch((url) => url.pathname.startsWith('/search/')
      ? Response.json([thingHit(5, { public_url: 'javascript:alert(1)', preview_image: 'http://insecure.example/a.jpg' })])
      : new Response('rate limited', { status: 429 }));
    const page = await thingiverseProvider({ token: 't', fetch }).search('cup', options());
    expect(page.total).toBeNull();
    expect(page.next).toBeNull(); // a short page without a total is the last one
    expect(page.results[0]).toMatchObject({ id: '5', url: 'https://www.thingiverse.com/thing:5', description: '', thumbnailUrl: 'https://cdn.thingiverse.com/assets/5/thumb.jpg' });
  });

  it('is reported as unconfigured without a token and never called', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ hits: [] }));
    const search = createModelSearch({ providers: [thingiverseProvider({ token: undefined, fetch })] });
    const response = await search.search('vase');
    expect(response.sources).toEqual([{
      source: 'thingiverse', label: 'Thingiverse', status: 'unconfigured', count: 0, total: null, hasMore: false,
      searchUrl: 'https://www.thingiverse.com/search?q=vase&type=things',
    }]);
    expect(response.next).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('Printables', () => {
  const items = [
    {
      id: '12345', name: 'Planter', slug: 'self-watering-planter', summary: 'Self-watering <b>planter</b>',
      image: { filePath: 'media/prints/12345/images/cover.jpg' }, user: { publicUsername: 'Prusa' },
    },
    { id: '67890', name: 'No image', slug: 'bad slug/../', summary: null, image: null, user: null },
    { id: 'not-a-number', name: 'Skipped' },
  ];

  it('queries GraphQL, maps images and model pages and continues with the returned cursor', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ data: { result: { items, cursor: 'c2', totalCount: 4521 } } }));
    const provider = printablesProvider({ fetch });
    const page = await provider.search('planter', options(null, 3));
    expect(calls[0].url.href).toBe('https://api.printables.com/graphql/');
    expect(calls[0].init.method).toBe('POST');
    const body = graphql(calls[0].init);
    expect(body.variables).toEqual({ query: 'planter', limit: 3, cursor: null });
    expect(body.query).toContain('searchPrints2');
    expect(page.total).toBe(4521);
    expect(page.next).toEqual({ variant: 0, cursor: 'c2', offset: 3 });
    expect(page.results).toEqual<ModelSearchResult[]>([
      {
        source: 'printables', id: '12345', title: 'Planter', description: 'Self-watering planter',
        thumbnailUrl: 'https://media.printables.com/media/prints/12345/images/cover.jpg',
        url: 'https://www.printables.com/model/12345-self-watering-planter', author: 'Prusa',
      },
      {
        source: 'printables', id: '67890', title: 'No image', description: '', thumbnailUrl: null,
        url: 'https://www.printables.com/model/67890', author: null,
      },
    ]);

    await provider.search('planter', options(page.next, 3));
    expect(graphql(calls[1].init).variables).toEqual({ query: 'planter', limit: 3, cursor: 'c2' });
  });

  it('stops when no cursor is returned or the total is reached', async () => {
    const { fetch } = fakeFetch(() => Response.json({ data: { result: { items, cursor: null, totalCount: 100 } } }));
    expect((await printablesProvider({ fetch }).search('planter', options(null, 3))).next).toBeNull();
    const { fetch: reached } = fakeFetch(() => Response.json({ data: { result: { items, cursor: 'more', totalCount: 6 } } }));
    expect((await printablesProvider({ fetch: reached }).search('planter', options({ variant: 0, cursor: 'c', offset: 3 }, 3))).next).toBeNull();
  });

  it('falls back to older request forms, pages by offset and starts with the form that last answered', async () => {
    const { fetch, calls } = fakeFetch((_url, init) => {
      const { query } = graphql(init);
      if (query.includes('searchPrints2')) return Response.json({ errors: [{ message: 'Unknown argument' }] }, { status: 400 });
      return Response.json({ data: { result: items.slice(0, 2) } });
    });
    const provider = printablesProvider({ fetch });
    const first = await provider.search('planter', options(null, 2));
    expect(calls).toHaveLength(3);
    expect(graphql(calls[2].init).query).toContain('searchPrints(');
    expect(first.results.map((result) => result.id)).toEqual(['12345', '67890']);
    expect(first.total).toBeNull();
    expect(first.next).toEqual({ variant: 2, offset: 2 }); // full page, total unknown

    await provider.search('planter', options(first.next, 2));
    expect(graphql(calls[3].init).variables).toEqual({ query: 'planter', limit: 2, offset: 2 });
    await provider.search('lamp', options(null, 2));
    expect(calls).toHaveLength(5);
    expect(graphql(calls[4].init).query).toContain('searchPrints(');
  });

  it('reports GraphQL errors when no request form works', async () => {
    const { fetch } = fakeFetch(() => Response.json({ errors: [{ message: 'Schema changed' }] }));
    await expect(printablesProvider({ fetch }).search('planter', options())).rejects.toThrow('Schema changed');
  });
});

describe('MakerWorld', () => {
  const hits = [
    { id: 4242, title: 'Benchy', cover: 'https://makerworld.bblmw.com/makerworld/model/cover.jpg', summary: '<p>Tug &amp; boat</p>', designCreator: { name: 'BambuLab' } },
    { id: 99, title: 'Adult', nsfw: true },
  ];

  it('maps search hits with the total and tries the next endpoint when one is unavailable', async () => {
    const { fetch, calls } = fakeFetch((url) => url.pathname.endsWith('/design2')
      ? new Response('blocked', { status: 403 })
      : Response.json({ total: 310, hits }));
    const provider = makerWorldProvider({ fetch });
    const page = await provider.search('benchy', options(null, 2));
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/api/v1/search-service/select/design2', '/api/v1/search-service/select/design',
    ]);
    expect(calls[1].url.searchParams.get('keyword')).toBe('benchy');
    expect(calls[1].url.searchParams.get('offset')).toBe('0');
    expect(page.total).toBe(310);
    expect(page.next).toEqual({ variant: 1, offset: 2 });
    expect(page.results).toEqual<ModelSearchResult[]>([{
      source: 'makerworld', id: '4242', title: 'Benchy', description: 'Tug & boat',
      thumbnailUrl: 'https://makerworld.bblmw.com/makerworld/model/cover.jpg', url: 'https://makerworld.com/en/models/4242', author: 'BambuLab',
    }]);

    const more = await provider.search('benchy', options(page.next, 2));
    expect(calls[2].url.pathname).toBe('/api/v1/search-service/select/design');
    expect(calls[2].url.searchParams.get('offset')).toBe('2');
    expect(more.next).toEqual({ variant: 1, offset: 4 });
  });

  it('ends at the total and fails when no endpoint returns search hits', async () => {
    const { fetch } = fakeFetch(() => Response.json({ data: { totalCount: 3, list: hits } }));
    expect(await makerWorldProvider({ fetch }).search('benchy', options({ variant: 0, offset: 1 }, 2))).toMatchObject({ total: 3, next: null });
    const { fetch: broken } = fakeFetch(() => Response.json({ code: 1, message: 'nope' }));
    await expect(makerWorldProvider({ fetch: broken }).search('benchy', options())).rejects.toThrow('Unexpected MakerWorld');
  });
});

const stubProvider = (source: ModelSearchProvider['source'], search: ModelSearchProvider['search']): ModelSearchProvider => ({
  source, label: source, configured: true, searchUrl: (query) => `https://${source}.example/search?q=${query}`, search,
  projectId: (url) => (url.hostname === `${source}.example` ? url.pathname.slice(1) : null),
  project: async (id) => ({
    project: { source, id, title: `${source} project ${id}`, description: '', thumbnailUrl: null, url: `https://${source}.example/${id}`, author: null, license: null },
    files: [], filesAvailable: false,
  }),
  downloadFile: async () => ({ data: Buffer.from('solid'), fileName: null }),
});
const result = (source: ModelSearchResult['source'], id: string): ModelSearchResult => ({
  source, id, title: `${source} ${id}`, description: '', thumbnailUrl: null, url: `https://${source}.com/${id}`, author: null,
});
const providerPage = (results: ModelSearchResult[], total: number | null = results.length, next: SourcePosition | null = null): ProviderPage =>
  ({ results, total, next });

describe('combined search', () => {
  it('interleaves sources, reports totals, keeps results when one source fails and caches only successes', async () => {
    const thingiverse = vi.fn(async () => providerPage([result('thingiverse', '1'), result('thingiverse', '2'), result('thingiverse', '3')], 1843, { page: 2 }));
    const printables = vi.fn(async () => providerPage([result('printables', '1')], null));
    const makerworld = vi.fn(async (): Promise<ProviderPage> => { throw new Error('HTTP 403'); });
    const log = vi.fn();
    const search = createModelSearch({
      providers: [stubProvider('thingiverse', thingiverse), stubProvider('printables', printables), stubProvider('makerworld', makerworld)],
      log,
    });
    const response = await search.search('Vase');
    expect(response.results.map((r) => `${r.source}:${r.id}`)).toEqual([
      'thingiverse:1', 'printables:1', 'thingiverse:2', 'thingiverse:3',
    ]);
    expect(response.sources.map(({ source, status, count, total, hasMore }) => ({ source, status, count, total, hasMore }))).toEqual([
      { source: 'thingiverse', status: 'ok', count: 3, total: 1843, hasMore: true },
      { source: 'printables', status: 'ok', count: 1, total: null, hasMore: false },
      { source: 'makerworld', status: 'error', count: 0, total: null, hasMore: false },
    ]);
    expect(response.next).toEqual({ thingiverse: { page: 2 } });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));

    await search.search('  vase ');
    expect(thingiverse).toHaveBeenCalledTimes(1);
    expect(makerworld).toHaveBeenCalledTimes(2);
  });

  it('loads the next page only from the sources named in the cursor, each from its own position', async () => {
    const thingiverse = vi.fn(async (_q: string, { position }: { position: SourcePosition | null }) =>
      providerPage([result('thingiverse', `p${position?.page ?? 1}`)], 30, { page: (position?.page ?? 1) + 1 }));
    const printables = vi.fn(async () => providerPage([]));
    const makerworld = vi.fn(async (_q: string, { position }: { position: SourcePosition | null }) =>
      providerPage([result('makerworld', `o${position?.offset ?? 0}`)], 13, null));
    const search = createModelSearch({
      providers: [stubProvider('thingiverse', thingiverse), stubProvider('printables', printables), stubProvider('makerworld', makerworld)],
    });
    const more = await search.search('vase', { thingiverse: { page: 3 }, makerworld: { variant: 1, offset: 12 } });
    expect(printables).not.toHaveBeenCalled();
    expect(thingiverse).toHaveBeenCalledWith('vase', expect.objectContaining({ position: { page: 3 } }));
    expect(more.results.map((r) => r.id)).toEqual(['p3', 'o12']);
    expect(more.sources.map((s) => s.source)).toEqual(['thingiverse', 'makerworld']);
    expect(more.next).toEqual({ thingiverse: { page: 4 } });

    await search.search('vase', { thingiverse: { page: 3 } });
    await search.search('vase', { thingiverse: { page: 4 } });
    expect(thingiverse).toHaveBeenCalledTimes(2); // page 3 came from the cache
  });

  it('gives up on a slow source after the timeout', async () => {
    const slow = stubProvider('makerworld', (_query, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const search = createModelSearch({
      providers: [slow, stubProvider('printables', async () => providerPage([result('printables', '1')]))], timeoutMs: 20, log: vi.fn(),
    });
    const response = await search.search('vase');
    expect(response.sources.map((source) => source.status)).toEqual(['error', 'ok']);
    expect(response.results).toHaveLength(1);
  });

  it('configures sources from the environment', async () => {
    expect(parseModelSources(undefined)).toEqual(['thingiverse', 'printables', 'makerworld']);
    expect(parseModelSources(' Printables, makerworld,printables ')).toEqual(['printables', 'makerworld']);
    expect(parseModelSources('')).toEqual([]);
    expect(() => parseModelSources('printables,cults3d')).toThrow('unknown source "cults3d"');
    const { fetch } = fakeFetch(() => Response.json({ data: { result: { items: [], cursor: null, totalCount: 0 } } }));
    const response = await modelSearchFromEnv({ MODEL_SEARCH_SOURCES: 'thingiverse,printables' }, fetch).search('vase');
    expect(response.sources.map(({ source, status, total }) => [source, status, total])).toEqual([
      ['thingiverse', 'unconfigured', null], ['printables', 'ok', 0],
    ]);
  });
});

describe('project pages', () => {
  it('reads a Thingiverse thing with its printable files and recognizes its links', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.pathname === '/things/42') {
        return Response.json({ ...thingHit(42), description: '## Summary\nA **hook**.', license: 'Creative Commons - Attribution' });
      }
      if (url.pathname === '/things/42/files') {
        return Response.json([
          { id: 1, name: 'hook.stl', size: 20480, thumbnail: 'https://cdn.thingiverse.com/f/1.jpg' },
          { id: 2, name: 'Hook_v2.3MF', size: '30000' },
          { id: 3, name: 'photo.jpg', size: 999 },
        ]);
      }
      return new Response('no', { status: 404 });
    });
    const provider = thingiverseProvider({ token: 't', fetch });
    const details = await provider.project('42', { signal: AbortSignal.timeout(5000) });
    expect(calls.every((call) => (call.init.headers as Record<string, string>).Authorization === 'Bearer t')).toBe(true);
    expect(details).toEqual({
      project: {
        source: 'thingiverse', id: '42', title: 'Thing 42', description: 'A hook.', thumbnailUrl: 'https://cdn.thingiverse.com/assets/42/thumb.jpg',
        url: 'https://www.thingiverse.com/thing:42', author: 'maker_anna', license: 'Creative Commons - Attribution',
      },
      files: [
        { id: '1', name: 'hook.stl', sizeBytes: 20480, thumbnailUrl: 'https://cdn.thingiverse.com/f/1.jpg' },
        { id: '2', name: 'Hook_v2.3MF', sizeBytes: 30000, thumbnailUrl: null },
      ],
      filesAvailable: true,
    });
    for (const [link, id] of [
      ['https://www.thingiverse.com/thing:42', '42'], ['https://thingiverse.com/thing:42/files', '42'],
      ['https://www.thingiverse.com/maker_anna/designs', null], ['https://evil.example/thing:42', null],
    ] as const) {
      expect(provider.projectId(new URL(link)), link).toBe(id);
    }
  });

  it('keeps a Thingiverse thing whose file list is unavailable', async () => {
    const { fetch } = fakeFetch((url) => (url.pathname === '/things/42' ? Response.json(thingHit(42)) : new Response('x', { status: 500 })));
    const details = await thingiverseProvider({ token: 't', fetch }).project('42', { signal: AbortSignal.timeout(5000) });
    expect(details.files).toEqual([]);
    expect(details.filesAvailable).toBe(false);
  });

  it('reads a Printables print with its STL files, falling back to plainer queries, and recognizes its links', async () => {
    const print = {
      id: '12345', name: 'Planter', slug: 'planter', summary: 'Short', description: '<p>Long &amp; detailed</p>',
      image: { filePath: 'media/cover.jpg' }, user: { publicUsername: 'Prusa' }, license: { name: 'CC BY-NC 4.0' },
      stls: [{ id: '9', name: 'planter.stl', fileSize: 4096, filePreviewPath: 'media/9.png' }, { id: 'bad id', name: 'x' }],
    };
    const { fetch, calls } = fakeFetch((_url, init) => {
      const { query } = graphql(init);
      if (query.includes('license')) return Response.json({ errors: [{ message: 'Cannot query field "license"' }] }, { status: 400 });
      const { license: _license, ...withoutLicense } = print;
      return Response.json({ data: { print: withoutLicense } });
    });
    const provider = printablesProvider({ fetch });
    const details = await provider.project('12345', { signal: AbortSignal.timeout(5000) });
    expect(calls).toHaveLength(2);
    expect(graphql(calls[1].init).variables).toEqual({ id: '12345' });
    expect(details).toEqual({
      project: {
        source: 'printables', id: '12345', title: 'Planter', description: 'Long & detailed', thumbnailUrl: 'https://media.printables.com/media/cover.jpg',
        url: 'https://www.printables.com/model/12345-planter', author: 'Prusa', license: null,
      },
      files: [{ id: '9', name: 'planter.stl', sizeBytes: 4096, thumbnailUrl: 'https://media.printables.com/media/9.png' }],
      filesAvailable: true,
    });
    for (const [link, id] of [
      ['https://www.printables.com/model/12345-planter', '12345'], ['https://www.printables.com/pl/model/12345', '12345'],
      ['https://printables.com/model/12345/files', '12345'], ['https://www.printables.com/search/models?q=x', null],
      ['https://www.printables.com/@Prusa', null], ['http://www.printables.com/model/12345', '12345'],
    ] as const) {
      expect(provider.projectId(new URL(link)), link).toBe(id);
    }
  });

  it('reads a MakerWorld design, offering its print profiles when no files are listed, and recognizes its links', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({
      id: 777, title: 'Benchy', summary: '<p>Boat</p>', cover: 'https://makerworld.bblmw.com/c.jpg', designCreator: { name: 'Bambu' },
      license: 'Standard Digital File License',
      instances: [{ id: 1, title: '0.2mm layer, 2 walls', cover: 'https://makerworld.bblmw.com/i1.jpg' }, { id: 2, title: 'Multicolor AMS' }],
    }));
    const provider = makerWorldProvider({ fetch });
    const details = await provider.project('777', { signal: AbortSignal.timeout(5000) });
    expect(calls[0].url.href).toBe('https://makerworld.com/api/v1/design-service/design/777');
    expect(details).toEqual({
      project: {
        source: 'makerworld', id: '777', title: 'Benchy', description: 'Boat', thumbnailUrl: 'https://makerworld.bblmw.com/c.jpg',
        url: 'https://makerworld.com/en/models/777', author: 'Bambu', license: 'Standard Digital File License',
      },
      files: [
        { id: '1', name: '0.2mm layer, 2 walls', sizeBytes: null, thumbnailUrl: 'https://makerworld.bblmw.com/i1.jpg' },
        { id: '2', name: 'Multicolor AMS', sizeBytes: null, thumbnailUrl: null },
      ],
      filesAvailable: true,
    });
    for (const [link, id] of [
      ['https://makerworld.com/en/models/777-benchy', '777'], ['https://makerworld.com/models/777', '777'],
      ['https://makerworld.com/zh-tw/models/777#profileId-1', '777'], ['https://makerworld.com/en/search/models?keyword=x', null],
    ] as const) {
      expect(provider.projectId(new URL(link)), link).toBe(id);
    }
  });

  it('resolves links to any source, caches project pages and reports unavailable sources', async () => {
    const thingiverse = stubProvider('thingiverse', async () => providerPage([]));
    const project = vi.fn(thingiverse.project);
    const search = createModelSearch({
      providers: [{ ...thingiverse, project }, { ...stubProvider('printables', async () => providerPage([])), configured: false }],
      log: vi.fn(),
    });
    expect(search.projectFromUrl(' https://thingiverse.example/42 ')).toEqual({ source: 'thingiverse', id: '42' });
    expect(search.projectFromUrl('https://printables.example/7')).toEqual({ source: 'printables', id: '7' });
    expect(search.projectFromUrl('https://elsewhere.example/42')).toBeNull();
    expect(search.projectFromUrl('not a url')).toBeNull();
    expect((await search.project({ source: 'thingiverse', id: '42' })).project.title).toBe('thingiverse project 42');
    await search.project({ source: 'thingiverse', id: '42' });
    expect(project).toHaveBeenCalledTimes(1);
    await expect(search.project({ source: 'printables', id: '7' })).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(search.project({ source: 'makerworld', id: '7' })).rejects.toBeInstanceOf(SourceUnavailableError);
  });
});

describe('downloading project files', () => {
  const signal = () => AbortSignal.timeout(5_000);
  const stl = Buffer.from('solid x\nendsolid x');
  const file = { id: '9', name: 'planter.stl', sizeBytes: 4096, thumbnailUrl: null };

  it('reads files up to a size limit, over HTTPS only', async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.pathname === '/declared') return new Response('x'.repeat(20), { headers: { 'Content-Length': '20' } });
      if (url.pathname === '/streamed') return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(8)); c.close(); } }));
      if (url.pathname === '/missing') return new Response('no', { status: 404 });
      return new Response(stl, { headers: { 'Content-Disposition': 'attachment; filename="a b.stl"' } });
    });
    expect(await fetchBinary(fetch, 'https://files.example/ok', { maxBytes: 100 })).toEqual({ data: stl, fileName: 'a b.stl' });
    await expect(fetchBinary(fetch, 'https://files.example/declared', { maxBytes: 10 })).rejects.toBeInstanceOf(FileTooLargeError);
    await expect(fetchBinary(fetch, 'https://files.example/streamed', { maxBytes: 10 })).rejects.toBeInstanceOf(FileTooLargeError);
    expect((await fetchBinary(fetch, 'https://files.example/streamed', { maxBytes: 16 })).data.length).toBe(16);
    await expect(fetchBinary(fetch, 'https://files.example/missing', { maxBytes: 10 })).rejects.toMatchObject({ status: 404 });
    await expect(fetchBinary(fetch, 'http://files.example/ok', { maxBytes: 100 })).rejects.toBeInstanceOf(UpstreamError);
    expect(dispositionFileName("attachment; filename=\"x.stl\"; filename*=UTF-8''wazon-%C5%82.stl")).toBe('wazon-ł.stl');
    expect(dispositionFileName(null)).toBeNull();
  });

  it('downloads Thingiverse files through the API with the app token', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(stl));
    const downloaded = await thingiverseProvider({ token: 'secret', fetch }).downloadFile('42', file, { signal: signal(), maxBytes: 1000 });
    expect(downloaded.data).toEqual(stl);
    expect(calls[0].url.href).toBe('https://api.thingiverse.com/files/9/download');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('asks Printables for a download link, trying the older mutation when needed', async () => {
    const link = 'https://files.printables.com/media/prints/12345/stls/planter.stl';
    let answer: unknown = { data: { getDownloadLink: { ok: true, errors: [], output: { link } } } };
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.href === link) return new Response(stl);
      const { query } = graphql(init);
      if (query.includes('$source')) return Response.json({ errors: [{ message: 'Unknown argument "source"' }] }, { status: 400 });
      return Response.json(answer);
    });
    const provider = printablesProvider({ fetch });
    expect((await provider.downloadFile('12345', file, { signal: signal(), maxBytes: 1000 })).data).toEqual(stl);
    expect(graphql(calls[0].init).variables).toEqual({ id: '9', printId: '12345', fileType: 'stl', source: 'model_detail' });
    expect(graphql(calls[1].init).variables).toEqual({ id: '9', printId: '12345', fileType: 'stl' });
    expect(calls[2].url.href).toBe(link);

    // Links elsewhere are never followed.
    answer = { data: { getDownloadLink: { ok: true, output: { link: 'https://evil.example/planter.stl' } } } };
    await expect(provider.downloadFile('12345', file, { signal: signal(), maxBytes: 1000 })).rejects.toThrow('Printables download link: none in the response');
    answer = { data: { getDownloadLink: { ok: false, errors: [{ field: 'id', messages: ['File not found'] }], output: null } } };
    await expect(provider.downloadFile('12345', file, { signal: signal(), maxBytes: 1000 })).rejects.toThrow('Printables download link: File not found');
  });

  it('downloads MakerWorld print profiles for a signed-in user', async () => {
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.hostname === 'makerworld.bblmw.com') return new Response(stl);
      if (!(init.headers as Record<string, string>).Authorization) return new Response('{}', { status: 401 });
      return Response.json({ name: 'Benchy.3mf', url: 'https://makerworld.bblmw.com/makerworld/model/1/Benchy.3mf' });
    });
    const profile = { ...file, id: '1', name: '0.2mm layer, 2 walls' };
    await expect(makerWorldProvider({ fetch }).downloadFile('777', profile, { signal: signal(), maxBytes: 1000 }))
      .rejects.toThrow('MakerWorld lets only signed-in users download: set MAKERWORLD_TOKEN');
    const downloaded = await makerWorldProvider({ fetch, token: 'tok' }).downloadFile('777', profile, { signal: signal(), maxBytes: 1000 });
    expect(downloaded).toEqual({ data: stl, fileName: 'Benchy.3mf' });
    expect(calls[1].url.href).toBe('https://makerworld.com/api/v1/design-service/instance/1/f3mf?type=download');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer tok', Cookie: 'token=tok' });
  });

  it('downloads only files the project lists, from available sources', async () => {
    const details: ProjectDetails = {
      project: { source: 'printables', id: '7', title: 'P', description: '', thumbnailUrl: null, url: 'https://printables.example/7', author: null, license: null },
      files: [file], filesAvailable: true,
    };
    const downloadFile = vi.fn(async () => ({ data: stl, fileName: null }));
    const search = createModelSearch({
      providers: [{ ...stubProvider('printables', vi.fn()), project: async () => details, downloadFile },
        { ...stubProvider('thingiverse', vi.fn()), configured: false }],
      maxDownloadBytes: 1234,
      log: vi.fn(),
    });
    expect(await search.downloadFile({ source: 'printables', id: '7' }, '9')).toEqual({ data: stl, fileName: null, file });
    expect(downloadFile).toHaveBeenCalledWith('7', file, { signal: expect.any(AbortSignal), maxBytes: 1234 });
    await expect(search.downloadFile({ source: 'printables', id: '7' }, '10')).rejects.toBeInstanceOf(FileNotListedError);
    await expect(search.downloadFile({ source: 'thingiverse', id: '7' }, '9')).rejects.toBeInstanceOf(SourceUnavailableError);
  });
});

describe('GET /api/model-search', () => {
  let db: Storage;
  let stop: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    ({ storage: db, stop } = await openTestStorage('model-search'));
  });
  afterAll(async () => {
    await stop?.();
  });

  const page = (query: string, next: ModelSearchPage['next']): ModelSearchPage => ({ query, results: [result('printables', '1')], sources: [], next });
  const details: ProjectDetails = {
    project: { source: 'printables', id: '12345', title: 'Planter', description: '', thumbnailUrl: null, url: 'https://www.printables.com/model/12345', author: null, license: null },
    files: [{ id: '9', name: 'planter.stl', sizeBytes: 4096, thumbnailUrl: null }],
    filesAvailable: true,
  };
  const searchStub = (project: ModelSearch['project']): ModelSearch => ({
    search: vi.fn(),
    projectFromUrl: (url) => (url.includes('printables.com/model/12345') ? { source: 'printables', id: '12345' } : null),
    project,
    downloadFile: vi.fn(),
  });

  it('looks up a project by link or by source and id, and reports lookup problems', async () => {
    const project = vi.fn(async () => details);
    const app = createApp({ db, adminToken: 'token', modelSearch: searchStub(project) });
    const byUrl = await request(app).get('/api/model-search/project').query({ url: 'https://www.printables.com/model/12345-planter' }).expect(200);
    expect(byUrl.body).toEqual(details);
    expect(project).toHaveBeenCalledWith({ source: 'printables', id: '12345' });
    await request(app).get('/api/model-search/project').query({ source: 'printables', id: '12345' }).expect(200);
    expect((await request(app).get('/api/model-search/project').query({ url: 'https://example.com/x' }).expect(400)).body.error)
      .toBe('Enter a link to a model page on Thingiverse, Printables or MakerWorld.');
    expect((await request(app).get('/api/model-search/project').query({ source: 'cults', id: '1' }).expect(400)).body.error)
      .toBe('Choose a model source and project id, or give a link.');
    await request(app).get('/api/model-search/project').query({ source: 'printables', id: '../x' }).expect(400);

    project.mockRejectedValueOnce(new SourceUnavailableError('printables'));
    expect((await request(app).get('/api/model-search/project').query({ source: 'printables', id: '1' }).expect(404)).body.error)
      .toBe('This model site is not available in this shop right now.');
    project.mockRejectedValueOnce(new Error('HTTP 503'));
    expect((await request(app).get('/api/model-search/project').query({ source: 'printables', id: '1' }).expect(502)).body.error)
      .toBe('This project could not be loaded from its website right now. Please try again later.');
  });

  it('returns unified results and an opaque cursor for the next page', async () => {
    const search = vi.fn(async (query: string) => page(query, { printables: { variant: 0, cursor: 'abc', offset: 12 }, thingiverse: { page: 2 } }));
    const app = createApp({ db, adminToken: 'token', allowedOrigins: ['https://shop.example'], modelSearch: { ...searchStub(vi.fn()), search } });
    const response = await request(app).get('/api/model-search').query({ q: '  twisted   vase ' })
      .set('Origin', 'https://shop.example').expect(200).expect('Access-Control-Allow-Origin', 'https://shop.example');
    expect(search).toHaveBeenCalledWith('twisted vase', undefined);
    expect(response.body).toEqual({ query: 'twisted vase', results: [result('printables', '1')], sources: [], nextCursor: expect.any(String) });
    expect(response.body).not.toHaveProperty('next');

    search.mockImplementationOnce(async (query: string) => page(query, null));
    const more = await request(app).get('/api/model-search').query({ q: 'twisted vase', cursor: response.body.nextCursor }).expect(200);
    expect(search).toHaveBeenLastCalledWith('twisted vase', { printables: { variant: 0, cursor: 'abc', offset: 12 }, thingiverse: { page: 2 } });
    expect(more.body.nextCursor).toBeNull();
  });

  it('rejects missing, too short and too long queries', async () => {
    const search = vi.fn();
    const app = createApp({ db, adminToken: 'token', modelSearch: { ...searchStub(vi.fn()), search } });
    for (const q of [undefined, '', ' a ', 'x'.repeat(101)]) {
      const response = await request(app).get('/api/model-search').query(q === undefined ? {} : { q }).expect(400);
      expect(response.body.error).toBe('Enter 2 to 100 characters to search for models.');
    }
    await request(app).get('/api/model-search?q=a&q=b').expect(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects tampered or malformed cursors', async () => {
    const search = vi.fn();
    const app = createApp({ db, adminToken: 'token', modelSearch: { ...searchStub(vi.fn()), search } });
    const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of ['not base64!', raw('text'), raw({}), raw({ cults3d: { offset: 1 } }), raw({ thingiverse: { page: 0 } }),
      raw({ makerworld: { offset: -1 } }), raw({ printables: { cursor: 'x'.repeat(1001) } }), raw({ printables: { offset: 1, extra: true } }),
      encodeCursor({ thingiverse: { page: 2 } }).repeat(200)]) {
      const response = await request(app).get('/api/model-search').query({ q: 'vase', cursor }).expect(400);
      expect(response.body.error).toBe('These search results can no longer be continued. Please search again.');
    }
    await request(app).get('/api/model-search?q=vase&cursor=a&cursor=b').expect(400);
    expect(search).not.toHaveBeenCalled();
  });
});
