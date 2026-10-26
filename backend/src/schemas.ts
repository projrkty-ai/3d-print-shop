import { z } from 'zod';
import { t } from './i18n';
import { MAX_QUANTITY } from './domain/config';
import { ORDER_STATUSES, type Customization, type OrderInput, type Product } from './domain/types';

/**
 * Request schemas. They check structure and types; business rules (e.g. a fixed fee no
 * higher than the base price) are checked by the shared `validateProduct`, so the admin UI
 * and the API report the same problems.
 */

const id = z.string().trim().min(1).max(120);
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const shortText = (max: number) => z.string().max(max);

const meshPart = z.object({ key: z.string().max(200), name: shortText(80), fileColor: hexColor });
const surfacePoint = { centerX: z.number().min(0).max(100), centerY: z.number().min(0).max(100) };
const decorationLayout = z.object({
  text: z.object({
    ...surfacePoint,
    horizontalAlign: z.enum(['left', 'center', 'right']),
    verticalAlign: z.enum(['top', 'middle', 'bottom']),
  }).optional(),
  texture: z.object({
    ...surfacePoint, width: z.number().min(1).max(100), height: z.number().min(1).max(100),
  }).optional(),
});

const productFields = {
  name: shortText(120),
  description: shortText(100_000),
  descriptionFormat: z.literal('html').optional(),
  gallery: z.array(z.object({
    type: z.enum(['image', 'video']),
    url: z.string().max(2000).refine((value) =>
      /^\/(?!\/)\S+$/.test(value) || (/^https?:\/\//i.test(value) && URL.canParse(value) && !/\s/.test(value)),
    t('mediaUrl')),
    alt: z.string().max(500),
  })).max(50).optional(),
  category: shortText(80),
  material: shortText(80),
  model: z.object({
    widthMm: z.number(),
    depthMm: z.number(),
    heightMm: z.number(),
    volumeCm3: z.number(),
  }),
  basePrice: z.number(),
  fixedFee: z.number(),
  productionDays: z.number(),
  // URL or a downscaled data URL from the admin's image upload.
  imageUrl: z.string().max(2_000_000),
  shape: z.enum(['vase', 'cylinder', 'box', 'sphere']),
  mesh: z
    .object({
      url: z.string().max(500),
      format: z.enum(['stl', '3mf']),
      fileName: shortText(255),
      sizeBytes: z.number().int().nonnegative(),
      triangleCount: z.number().int().nonnegative(),
      parts: z.array(meshPart).max(16),
      // Defaults keep products saved before plate support valid.
      plates: z
        .array(z.object({
          id: z.number().int(),
          name: shortText(120),
          objectCount: z.number().int().nonnegative(),
          parts: z.array(meshPart).max(16).optional(),
          decorationLayout: decorationLayout.optional(),
          model: z.object({
            widthMm: z.number().positive(), depthMm: z.number().positive(), heightMm: z.number().positive(),
            volumeCm3: z.number().nonnegative(),
          }).optional(),
        }))
        .max(200)
        .default([]),
      plate: z.number().int().nullable().default(null),
      selectedPlates: z.array(z.number().int()).min(1).max(200).optional(),
    })
    .nullable(),
  published: z.boolean(),
  colors: z.array(z.object({ id, name: shortText(80), hex: z.string().max(20), priceDelta: z.number() })).max(50),
  engraving: z.object({
    enabled: z.boolean(),
    maxLength: z.number(),
    maxLines: z.number(),
    price: z.number(),
    fonts: z.array(shortText(60)).max(20),
    colorChoice: z.boolean(),
    colorPrice: z.number(),
  }),
  texture: z.object({ enabled: z.boolean(), price: z.number() }),
  decorationLayout: decorationLayout.optional(),
};

/** Body of POST/PUT /api/products. The id and timestamps are managed by the server. */
export const productInput = z.object(productFields);
export type ProductInput = z.infer<typeof productInput>;

// Compile-time guard: the schema must describe exactly the editable part of `Product`.
type Editable = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;
const _schemaMatchesProduct: [ProductInput, Editable] extends [Editable, ProductInput] ? true : never = true;
void _schemaMatchesProduct;

const surfaceCustomization = z.object({
  colorId: z.string().max(120),
  partColors: z.record(z.string().max(200), z.string().max(120)),
  engravingText: z.string().max(500),
  engravingFont: z.string().max(60),
  engravingColorId: z.string().max(120).nullable(),
  // The browser downscales uploads to ~512 px JPEGs; anything else is rejected.
  textureDataUrl: z
    .string()
    .max(3_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, t('textureUrl'))
    .nullable(),
});

const customization = surfaceCustomization.extend({
  dimensions: z.object({ widthMm: z.number(), depthMm: z.number(), heightMm: z.number() }),
  plates: z.record(z.string().regex(/^-?\d+$/), surfaceCustomization).refine(
    (plates) => Object.keys(plates).length <= 200, t('plateLimit'),
  ).optional(),
}) satisfies z.ZodType<Customization>;

const required = (message: string, max: number) => z.string().trim().min(1, message).max(max);

export const orderInput = z.object({
  customer: z.object({
    name: required(t('nameRequired'), 120),
    email: z.email(t('email')).max(200),
    phone: z.string().trim().max(40).optional(),
    address: z.object({
      line1: required(t('addressRequired'), 200),
      line2: z.string().trim().max(200).optional(),
      city: required(t('cityRequired'), 100),
      postalCode: required(t('postalRequired'), 20),
      country: required(t('countryRequired'), 100),
    }),
  }),
  items: z
    .array(z.object({ productId: id, customization, quantity: z.number().int().min(1).max(MAX_QUANTITY) }))
    .min(1, t('emptyOrder'))
    .max(50),
  customerNote: z.string().trim().max(1000).optional(),
}) satisfies z.ZodType<OrderInput>;

/** Body of PATCH /api/orders/:id — what an admin may change after an order is placed. */
export const orderUpdate = z
  .object({ status: z.enum(ORDER_STATUSES), adminNote: z.string().max(5000) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, t('emptyUpdate'));
