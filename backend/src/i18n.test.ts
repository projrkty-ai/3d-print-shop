import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Collections } from './db';
import type { OrderInput } from './domain/types';

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Collections;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = openDatabase(client.db('localization'));
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const messages = {
  en: {
    auth: 'Admin access required.',
    missing: 'Endpoint not found.',
    invalid: 'Invalid request.',
    required: 'Name is required.',
    email: 'Enter a valid email address.',
    builtin: 'Invalid input: expected number, received string',
    dimension: 'Width must be at least 5 mm.',
    engraving: 'Engraving must fit on a single line.',
    position: 'Text horizontal position must be between 0 and 100%.',
    print: 'Print ',
    color: 'Color: ',
    original: 'Original',
    multiColor: 'Multi-color',
    unavailable: 'Item 1: this product is no longer available.',
    fixedFee: 'fixed fee',
  },
  pl: {
    auth: 'Wymagany jest dostęp administratora.',
    missing: 'Nie znaleziono punktu końcowego.',
    invalid: 'Nieprawidłowe żądanie.',
    required: 'Nazwa jest wymagana.',
    email: 'Podaj prawidłowy adres e-mail.',
    builtin: 'Nieprawidłowe dane wejściowe: oczekiwano liczba, otrzymano string',
    dimension: 'Szerokość musi wynosić co najmniej 5 mm.',
    engraving: 'Grawer musi mieścić się w jednym wierszu.',
    position: 'Tekst: pozycja pozioma musi wynosić od 0 do 100%.',
    print: 'Wydruk ',
    color: 'Kolor: ',
    original: 'Oryginalny',
    multiColor: 'Wielokolorowy',
    unavailable: 'Pozycja 1: ten produkt nie jest już dostępny.',
    fixedFee: 'opłaty stałej',
  },
};

describe.each(['en', 'pl'] as const)('%s localization', (language) => {
  it('localizes API errors, custom and built-in Zod issues while preserving paths and statuses', async () => {
    vi.stubEnv('APP_LANGUAGE', language);
    vi.resetModules();
    const { createApp } = await import('./app');
    const app = createApp({ db, adminToken: 'localization-test' });
    const expected = messages[language];
    expect((await request(app).get('/api/orders').expect(401)).body).toEqual({ error: expected.auth });
    expect((await request(app).get('/api/missing').expect(404)).body).toEqual({ error: expected.missing });
    const { body } = await request(app).post('/api/orders').send({
      customer: { name: '', email: 'invalid', address: {} },
      items: [{ productId: 'unchanged-id', quantity: 'bad', customization: {} }],
    }).expect(400);
    expect(body.error).toBe(expected.invalid);
    expect(body.details).toContain(`customer.name: ${expected.required}`);
    expect(body.details).toContain(`customer.email: ${expected.email}`);
    expect(body.details).toContain(`items.0.quantity: ${expected.builtin}`);
    const invalidStatus = await request(app).get('/api/orders?status=wrong')
      .set('Authorization', 'Bearer localization-test').expect(400);
    expect(invalidStatus.body.error).toContain('pending, paid, printing, shipped, delivered, cancelled');
  });

  it('localizes domain validation and new snapshots without translating product or customer data', async () => {
    vi.stubEnv('APP_LANGUAGE', language);
    vi.resetModules();
    const { createSeedProducts } = await import('./domain/data/seedProducts');
    const { defaultCustomization } = await import('./domain/utils/customization');
    const { validateDimensions } = await import('./domain/utils/sizing');
    const { validateProduct, validateEngraving } = await import('./domain/utils/validation');
    const { decorationLayoutErrors, DEFAULT_TEXT_LAYOUT } = await import('./domain/utils/decorationLayout');
    const { summarizeConfiguration } = await import('./domain/utils/orderLines');
    const { priceOrderItems } = await import('./orders');
    const { createApp } = await import('./app');
    const expected = messages[language];
    const product = createSeedProducts().find((p) => p.id === 'spiral-vase')!;
    product.name = 'Original product Name';
    product.colors[0] = { ...product.colors[0], name: 'Original Color', priceDelta: 3 };
    const customization = defaultCustomization(product);
    expect(validateDimensions({ ...customization.dimensions, widthMm: 4 })).toBe(expected.dimension);
    expect(validateEngraving('One\nTwo', { maxLength: 50, maxLines: 1 })).toBe(expected.engraving);
    expect(validateProduct({ ...product, name: '' })).toContain(expected.required);
    expect(decorationLayoutErrors({ text: { ...DEFAULT_TEXT_LAYOUT, centerX: -1 } })).toContain(expected.position);
    const input: OrderInput = {
      customer: {
        name: 'Customer Name', email: 'customer@example.com',
        address: { line1: 'Address', city: 'City', postalCode: '00-001', country: 'Country' },
      },
      items: [{ productId: product.id, customization, quantity: 1 }],
      customerNote: 'Original customer content',
    };
    await db.products.replaceOne({ id: product.id }, product, { upsert: true });
    const app = createApp({ db, adminToken: 'localization-test' });
    const { body } = await request(app).post('/api/orders').send(input).expect(201);
    expect(body.currency).toBe('USD');
    expect(body.status).toBe('pending');
    expect(body.customer).toEqual(input.customer);
    expect(body.customerNote).toBe(input.customerNote);
    expect(body.items[0].productName).toBe(product.name);
    expect(body.items[0].colorName).toBe('Original Color');
    expect(body.items[0].priceLines[0].label).toMatch(new RegExp(`^${expected.print}`));
    expect(body.items[0].priceLines[0].note).toContain(expected.fixedFee);
    expect(body.items[0].priceLines[1]).toEqual({ label: `${expected.color}Original Color`, amount: 3 });
    expect(body.total).toBe(35);
    const stored = await db.orders.findOne({ id: body.id });
    expect(stored?.items[0].priceLines).toEqual(body.items[0].priceLines);
    vi.stubEnv('APP_LANGUAGE', language === 'pl' ? 'en' : 'pl');
    vi.resetModules();
    const { createApp: createOtherLanguageApp } = await import('./app');
    const otherApp = createOtherLanguageApp({ db, adminToken: 'localization-test' });
    const existing = await request(otherApp).get(`/api/orders/${body.id}`)
      .set('Authorization', 'Bearer localization-test').expect(200);
    expect(existing.body).toEqual(body);

    product.mesh = {
      url: '/models/test.3mf', format: '3mf', fileName: 'test.3mf',
      sizeBytes: 1, triangleCount: 1, plates: [], plate: null,
      parts: [{ key: 'body', name: 'Original Part', fileColor: '#ffffff' }],
    };
    const summary = summarizeConfiguration(product, defaultCustomization(product));
    expect(summary.colorName).toBe(expected.multiColor);
    expect(summary.parts?.[0]).toEqual({ name: 'Original Part', colorName: expected.original, colorHex: '#ffffff' });
    try {
      priceOrderItems(input, new Map());
      expect.fail('Missing product must fail checkout');
    } catch (error) {
      expect(error).toMatchObject({ status: 400, details: [expected.unavailable] });
    }
  });
});

it('defaults only an unset language to English and fails explicitly for unsupported values', async () => {
  vi.stubEnv('APP_LANGUAGE', undefined);
  vi.resetModules();
  const { language, parseLanguage, t } = await import('./i18n');
  expect(language).toBe('en');
  expect(t('adminRequired')).toBe(messages.en.auth);
  expect(parseLanguage('pl')).toBe('pl');
  for (const value of ['', 'de', 'PL', ' pl ']) {
    expect(() => parseLanguage(value)).toThrow('APP_LANGUAGE must be "en" or "pl".');
  }
  vi.stubEnv('APP_LANGUAGE', 'de');
  vi.resetModules();
  await expect(import('./app')).rejects.toThrow('APP_LANGUAGE must be "en" or "pl".');
});
