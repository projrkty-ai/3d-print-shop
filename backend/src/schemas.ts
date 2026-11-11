import { z } from 'zod';
import { t } from './i18n';
import { CUSTOM_ORDER_MAX_FILES, MAX_QUANTITY } from './domain/config';
import { TEMPLATE_LIMITS } from './domain/emailTemplates';
import { PRINT_SETTINGS_LIMITS } from './domain/printSettings';
import { PRINTER_LIMITS } from './domain/printers';
import { SLICING_LIMITS } from './domain/utils/printVariants';
import {
  MAX_FILAMENTS, MODEL_SOURCES, ORDER_STATUSES, PRINT_MATERIALS, PROJECT_MATERIALS,
  type Customer, type Customization, type MeasurementsInput, type OrderInput, type PrintSettings, type Product, type PrinterInput,
  type PrinterModelInput, type ProjectPrintChoice, type ProjectQuoteInput, type ProjectReviewInput, type UploadEstimateInput,
} from './domain/types';

/**
 * Request schemas. They check structure and types; business rules (e.g. a fixed fee no
 * higher than the base price) are checked by the shared `validateProduct`, so the admin UI
 * and the API report the same problems.
 */

const id = z.string().trim().min(1).max(120);
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const shortText = (max: number) => z.string().max(max);

/** Print time and filament per material (value bounds are checked by validateProduct). */
const sliceMeasurements = z.object({
  printMinutes: z.number(),
  filaments: z.array(z.object({ material: z.enum(PRINT_MATERIALS), grams: z.number() })).max(MAX_FILAMENTS),
});

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
  // Value bounds are business rules, reported by the shared validateProduct.
  extrudedText: z.object({
    x: z.number(), y: z.number(), z: z.number(),
    rotationDeg: z.number(), tiltDeg: z.number(),
    sizeMm: z.number(), depthMm: z.number(), lineSpacing: z.number(),
    horizontalAlign: z.enum(['left', 'center', 'right']),
    verticalAlign: z.enum(['top', 'middle', 'bottom']),
    defaultText: z.string().max(200),
  }).optional(),
});

/** A model file (STL/3MF) of a product, with the editor's analysis of its parts and plates. */
const meshFile = z
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
  .nullable();

/** Sliced print variants per plate; values are checked by the shared validateProduct. */
const plateSlicing = z.array(z.object({
  plateId: z.number().int().nullable(),
  matrix: z.object({
    printers: z.array(shortText(200)).max(SLICING_LIMITS.matrixEntries),
    processes: z.array(shortText(200)).max(SLICING_LIMITS.matrixEntries),
    filaments: z.array(shortText(200)).max(SLICING_LIMITS.matrixEntries),
  }),
  support: z.boolean(),
  overrides: z.record(z.string().regex(/^[a-z0-9_]{1,80}$/i), z.string().max(200))
    .refine((value) => Object.keys(value).length <= SLICING_LIMITS.overrides, t('slicingOverrides', SLICING_LIMITS.overrides)),
  variants: z.array(z.object({
    id,
    label: shortText(SLICING_LIMITS.label),
    presets: z.object({ printer: shortText(200), process: shortText(200), filament: shortText(200) }),
    nozzleMm: z.number(),
    layerHeightMm: z.number(),
    material: z.enum(PRINT_MATERIALS),
    measurements: sliceMeasurements,
    sliced: sliceMeasurements.extend({ slicedAt: z.string().max(40) }).optional(),
    scaled: z.array(z.object({
      scale: z.number(),
      measurements: sliceMeasurements,
      sliced: sliceMeasurements.extend({ slicedAt: z.string().max(40) }).optional(),
    })).max(SLICING_LIMITS.scales).optional(),
    enabled: z.boolean(),
  })).max(SLICING_LIMITS.variants),
  defaultVariantId: id.nullable(),
})).max(200).optional();

/** Range bounds are business rules, reported by the shared validateProduct. */
const productScaling = z.object({ enabled: z.boolean(), minScale: z.number(), maxScale: z.number() }).optional();

const modelSpec = z.object({
  widthMm: z.number(),
  depthMm: z.number(),
  heightMm: z.number(),
  volumeCm3: z.number(),
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
  model: modelSpec,
  basePrice: z.number(),
  fixedFee: z.number(),
  productionDays: z.number(),
  // URL or a downscaled data URL from the admin's image upload.
  imageUrl: z.string().max(2_000_000),
  shape: z.enum(['vase', 'cylinder', 'box', 'sphere']),
  mesh: meshFile,
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
  texture: z.object({
    enabled: z.boolean(),
    price: z.number(),
    // Both optional so products saved before the texture library stay valid.
    options: z.array(z.object({
      id,
      name: shortText(80),
      // Shop textures are drawn onto the preview canvas, which needs images served by the API itself.
      url: z.string().max(500).regex(/^\/(?!\/)\S+$/, t('textureImageUrl')),
    })).max(50).optional(),
    allowCustom: z.boolean().optional(),
  }),
  decorationLayout: decorationLayout.optional(),
  // Sliced print variants; values are checked by the shared validateProduct.
  slicing: plateSlicing,
  // Range bounds are business rules, reported by the shared validateProduct.
  scaling: productScaling,
};

/** Body of POST/PUT /api/products. The id and timestamps are managed by the server. */
export const productInput = z.object(productFields);
export type ProductInput = z.infer<typeof productInput>;

// Compile-time guard: the schema must describe exactly the editable part of `Product`.
type Editable = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'catalogPricing'>;
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
  textureId: z.string().max(120).nullable().optional(),
  variantId: z.string().max(120).optional(),
  extrudedText: z.string().max(500).optional(),
  extrudedSizeMm: z.number().optional(),
});

const customization = surfaceCustomization.extend({
  dimensions: z.object({ widthMm: z.number(), depthMm: z.number(), heightMm: z.number() }),
  plates: z.record(z.string().regex(/^-?\d+$/), surfaceCustomization).refine(
    (plates) => Object.keys(plates).length <= 200, t('plateLimit'),
  ).optional(),
}) satisfies z.ZodType<Customization>;

const required = (message: string, max: number) => z.string().trim().min(1, message).max(max);

/** Contact and shipping details, the same for catalog checkout and print requests. */
const customer = z.object({
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
}) satisfies z.ZodType<Customer>;

/** Status-change email options: send the status template, with the admin's optional `note` (its {{note}}). */
const notification = { notify: z.boolean(), note: z.string().max(5000) };

const money = z.number().min(0).max(100_000);

/** Body of PUT /api/settings/pricing: the shop's rates for pricing project orders. */
export const pricingSettingsInput = z.object({
  hourlyRate: money,
  handlingFee: money,
  filamentPricePerKg: z.object(Object.fromEntries(PRINT_MATERIALS.map((material) => [material, money])) as Record<(typeof PRINT_MATERIALS)[number], typeof money>).strict(),
}).strict();

/** Print time and filament per material: the measurements every project price is calculated from. */
export const printMeasurements = z.object({
  printMinutes: z.number().int().min(0).max(100_000),
  filaments: z.array(z.object({ material: z.enum(PRINT_MATERIALS), grams: z.number().positive().max(100_000) }).strict())
    .min(1, t('reviewFilaments')).max(20),
}).strict() satisfies z.ZodType<ProjectReviewInput>;

const productText = {
  title: required(t('nameRequired'), 200),
  description: z.string().trim().max(5000),
  published: z.boolean(),
};

/** Body of POST /api/project-products: a ready-to-print product made from a reviewed project order. */
export const projectProductCreate = z.object({ orderId: z.string().min(1).max(120), ...productText }).strict();

export const projectProductUpdate = z.object({
  ...productText,
  measurements: printMeasurements,
  // The print file, its size, scaling and sliced variants; checked by `projectPrintErrors`.
  mesh: meshFile,
  model: modelSpec,
  slicing: plateSlicing.unwrap(),
  scaling: productScaling.unwrap(),
}).partial().strict()
  .refine((value) => Object.keys(value).length > 0, t('emptyUpdate'));

/** A customer's print variants and scale for a sliced Print on Demand product. */
const projectPrintChoice = z.object({
  scale: z.number().positive().max(10),
  variants: z.record(z.string().max(20), z.string().max(120)),
}).strict() satisfies z.ZodType<ProjectPrintChoice>;

/** Body of POST /api/project-products/:id/quote. */
export const projectQuoteInput = z.object({
  sets: z.number().int().min(1).max(MAX_QUANTITY),
  print: projectPrintChoice.optional(),
}).strict() satisfies z.ZodType<ProjectQuoteInput>;

/** Print time and filament of one copy: grams per color part (uploads) or per material. */
const measurementsInput = z.object({
  printMinutes: z.number().min(0).max(60 * 24 * 60),
  filaments: z.array(z.object({ key: z.string().min(1).max(200), grams: z.number().min(0).max(100_000) }).strict())
    .min(1, t('reviewFilaments')).max(20),
}).strict() satisfies z.ZodType<MeasurementsInput>;

/** The slicer profile and scale a customer's model is sliced with; presets are checked against the offer. */
const customerProfile = z.object({
  printer: shortText(200),
  process: shortText(200),
  filament: shortText(200),
  support: z.boolean(),
  scale: z.number(),
}).strict();

const customerNote = z.string().trim().max(2000).optional();

const catalogOrder = z.object({
  source: z.literal('catalog'),
  customer,
  customerNote,
  items: z
    .array(z.object({ productId: id, customization, quantity: z.number().int().min(1).max(MAX_QUANTITY) }))
    .min(1, t('emptyOrder'))
    .max(50),
});

/** Files uploaded beforehand, each proven by the key its upload returned. */
const uploadOrder = z.object({
  source: z.literal('upload'),
  customer,
  customerNote,
  items: z
    .array(z.object({
      fileId: z.string().regex(/^[0-9a-f]{24}$/),
      uploadKey: z.string().min(16).max(200),
      quantity: z.number().int().min(1).max(MAX_QUANTITY),
      nozzleId: id.optional(),
      layerHeightId: id.optional(),
      profile: customerProfile.optional(),
      estimate: measurementsInput.optional(),
      // Color parts come from the customer's reading of the file (at most 8 colors, `model` when single-color).
      parts: z
        .array(z.object({ key: z.string().min(1).max(200), name: shortText(80), filamentId: id, colorId: id }))
        .min(1)
        .max(16)
        .refine((parts) => new Set(parts.map((part) => part.key)).size === parts.length, t('duplicateParts')),
    }))
    .min(1, t('noFiles'))
    .max(CUSTOM_ORDER_MAX_FILES, t('tooManyFiles', CUSTOM_ORDER_MAX_FILES))
    .refine((items) => new Set(items.map((item) => item.fileId)).size === items.length, t('duplicateFiles')),
});

const externalId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);
const filamentChoices = z.array(z.object({ material: z.enum(PROJECT_MATERIALS), color: z.string().trim().max(60) }).strict())
  .min(1, t('projectFilaments', MAX_FILAMENTS)).max(MAX_FILAMENTS, t('projectFilaments', MAX_FILAMENTS));

/** A customer's request to print an external project. */
const projectOrder = z.object({
  source: z.literal('project'),
  customer,
  customerNote,
  project: z.object({
    source: z.enum(MODEL_SOURCES),
    id: externalId,
    title: required(t('projectTitle'), 300),
    url: httpsUrl,
    thumbnailUrl: httpsUrl.nullable(),
    author: z.string().trim().max(120).nullable(),
  }),
  items: z.array(z.object({
    file: z.object({ id: externalId, name: required(t('projectTitle'), 300) }).nullable(),
    settings: z.object({
      quantity: z.number().int().min(1).max(MAX_QUANTITY),
      scalePercent: z.number().int().min(10).max(500),
      filaments: filamentChoices,
    }).strict(),
  })).min(1, t('projectItems')).max(200),
  sameSettingsForAll: z.boolean(),
}).superRefine((order, context) => {
  const ids = order.items.map((item) => item.file?.id ?? null);
  if (ids.includes(null) && ids.length > 1) context.addIssue({ code: 'custom', path: ['items'], message: t('projectWholeItem') });
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['items'], message: t('projectDuplicateItem') });
  const first = JSON.stringify(order.items[0]?.settings);
  if (order.sameSettingsForAll && order.items.some((item) => JSON.stringify(item.settings) !== first)) {
    context.addIssue({ code: 'custom', path: ['items'], message: t('projectSameSettings') });
  }
});

/** Sets of a Print on Demand product, with the customer's materials and colors. */
const printOnDemandOrder = z.object({
  source: z.literal('printOnDemand'),
  customer,
  customerNote,
  productId: id,
  sets: z.number().int().min(1).max(MAX_QUANTITY),
  items: z.array(z.object({ fileId: externalId.nullable(), filaments: filamentChoices }).strict()).max(200).optional(),
  print: projectPrintChoice.optional(),
});

/**
 * Body of POST /api/orders: the customer and note like every order, and the models from one source.
 * A body without `source` is a catalog checkout (as older storefronts send it).
 */
export const orderInput = z.preprocess(
  (body) => (body && typeof body === 'object' && !('source' in body) ? { ...body, source: 'catalog' } : body),
  z.discriminatedUnion('source', [catalogOrder, uploadOrder, projectOrder, printOnDemandOrder]),
) satisfies z.ZodType<OrderInput, unknown>;

type Body = Record<string, unknown>;
const asBody = (value: unknown): Body => (value && typeof value === 'object' ? value as Body : {});
const legacyMeasurements = (estimate: unknown) => {
  const { parts, ...rest } = asBody(estimate);
  return parts === undefined ? estimate : { ...rest, filaments: parts };
};

/** Body of the former POST /api/custom-orders: `files`, with estimates per `parts`. */
export const legacyUploadOrderInput = z.preprocess((value) => {
  const { files, ...body } = asBody(value);
  const items = Array.isArray(files)
    ? files.map((file: unknown) => {
      const { estimate, ...rest } = asBody(file);
      return estimate === undefined ? rest : { ...rest, estimate: legacyMeasurements(estimate) };
    })
    : files;
  return { ...body, source: 'upload', items };
}, uploadOrder);

/** Body of the former POST /api/project-orders: the note was `notes`. */
export const legacyProjectOrderInput = z.preprocess((value) => {
  const { notes, ...body } = asBody(value);
  return { ...body, source: 'project', ...(typeof notes === 'string' && notes.trim() && { customerNote: notes }) };
}, projectOrder);

/** Body of the former POST /api/project-products/:id/orders. */
export const legacyPrintOnDemandOrderInput = (productId: string) => z.preprocess((value) => {
  const { notes, ...body } = asBody(value);
  return { ...body, source: 'printOnDemand', productId, ...(typeof notes === 'string' && notes.trim() && { customerNote: notes }) };
}, printOnDemandOrder);

/** A printer's queue to put an order in (status `queued`), with the order's print time when not measured. */
const queueInput = z.object({
  printerId: z.string().min(1).max(120),
  printMinutes: z.number({ error: t('queuePrintMinutes') }).int(t('queuePrintMinutes')).min(1, t('queuePrintMinutes')).max(60 * 24 * 60, t('queuePrintMinutes')).optional(),
}).strict();

/** Body of PATCH /api/orders/:id — what an admin may change after an order is placed. */
export const orderUpdate = z
  .object({
    status: z.enum(ORDER_STATUSES),
    adminNote: z.string().max(5000),
    price: z.number({ error: t('quotedPrice') }).min(0, t('quotedPrice')).max(1_000_000).nullable(),
    queue: queueInput,
    ...notification,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, t('emptyUpdate'));

/** Body of PUT /api/orders/:id/items/:index/review: the shop's measurements of one copy, possibly as sliced. */
export const itemReviewInput = measurementsInput.extend({
  sliced: measurementsInput.extend({ slicedAt: z.string().max(40) }).strict().optional(),
}).strict();

/** Body of POST /api/uploads/estimate (the former /custom-orders/estimate sent `files` and `parts`). */
export const uploadEstimateInput = z.preprocess((value) => {
  const { files, items, ...body } = asBody(value);
  const lines = items ?? files;
  return {
    ...body,
    items: Array.isArray(lines) ? lines.map((line: unknown) => ({ ...asBody(line), estimate: legacyMeasurements(asBody(line).estimate) })) : lines,
  };
}, z.object({
  items: z.array(z.object({
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
    parts: z.array(z.object({ key: z.string().min(1).max(200), filamentId: id }).strict()).min(1).max(16),
    estimate: measurementsInput,
  }).strict()).min(1).max(CUSTOM_ORDER_MAX_FILES),
}).strict()) satisfies z.ZodType<UploadEstimateInput, unknown>;

/** Body of PUT /api/print-settings. Business rules are checked by `validatePrintSettings`. */
const presetNames = z.array(shortText(200)).max(PRINT_SETTINGS_LIMITS.profilePresets);

export const printSettingsInput = z.object({
  profiles: z.object({ printers: presetNames, processes: presetNames, filaments: presetNames }).optional(),
  nozzles: z.array(z.object({ id, diameterMm: z.number(), priceMultiplier: z.number() })).max(PRINT_SETTINGS_LIMITS.nozzles),
  defaultNozzleId: z.string().max(120),
  layerHeights: z.array(z.object({ id, heightMm: z.number(), priceMultiplier: z.number() })).max(PRINT_SETTINGS_LIMITS.layerHeights),
  defaultLayerHeightId: z.string().max(120),
  filaments: z.array(z.object({
    id,
    name: shortText(80),
    description: shortText(300),
    pricePerKg: z.number(),
    densityGPerCm3: z.number(),
    colors: z.array(z.object({ id, name: shortText(80), hex: z.string().max(20) })).max(PRINT_SETTINGS_LIMITS.colors),
  })).max(PRINT_SETTINGS_LIMITS.filaments),
}) satisfies z.ZodType<Omit<PrintSettings, 'updatedAt'>>;

/** Body of POST …/:id/messages: the admin's own email to the customer. */
export const customerMessageInput = z.object({
  subject: z.string().trim().min(1, t('messageSubject')).max(200).refine((value) => !/[\r\n]/.test(value), t('messageSubjectLine')),
  body: z.string().trim().min(1, t('messageBody')).max(20_000),
});

/** Body of POST /api/orders/:id/email-preview: the status email for an unsaved status change. */
export const emailPreviewInput = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().max(5000).optional(),
  price: z.number().min(0).max(1_000_000).nullable().optional(),
  queue: queueInput.optional(),
});

/** Body of PUT /api/email-templates. The required variables are checked by `validateEmailTemplates`. */
export const emailTemplatesInput = z.object({
  templates: z.record(z.string(), z.object({ subject: z.string().max(TEMPLATE_LIMITS.subject), body: z.string().max(TEMPLATE_LIMITS.body) })),
});

/**
 * Body of POST /api/printer-models and PUT /api/printer-models/:id. Texts may be a little longer than
 * the limits (they are trimmed first); value bounds and uniqueness are reported by `validatePrinterModel` and the route.
 */
export const printerModelInput = z.object({
  name: z.string().max(PRINTER_LIMITS.model + 20),
  manufacturer: z.string().max(PRINTER_LIMITS.manufacturer + 20).default(''),
  plate: z.object({ widthMm: z.number(), depthMm: z.number(), heightMm: z.number() }),
  maxColors: z.number(),
}).strict() satisfies z.ZodType<PrinterModelInput, unknown>;

/**
 * Body of POST /api/printers and PUT /api/printers/:id. The plate size, colors and profiles belong to
 * the model; `validatePrinter` and the route report problems and a missing model.
 */
export const printerInput = z.object({
  name: z.string().max(PRINTER_LIMITS.name + 20),
  modelId: z.string().max(120),
  location: z.string().max(PRINTER_LIMITS.location + 20).default(''),
  notes: z.string().max(PRINTER_LIMITS.notes + 20).default(''),
}).strict() satisfies z.ZodType<PrinterInput, unknown>;
