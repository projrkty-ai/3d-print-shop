/** Geometry used by the live 3D preview on the product page. */
export type PreviewShape = 'vase' | 'cylinder' | 'box' | 'sphere';

/** Print size along each axis, in millimeters. */
export interface Dimensions {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export type MeshFormat = 'stl' | '3mf';

/** Percent coordinates on the unwrapped surface: X runs around it, Y runs bottom to top. */
export interface SurfacePoint {
  centerX: number;
  centerY: number;
}

export interface TextLayout extends SurfacePoint {
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
}

export interface TextureLayout extends SurfacePoint {
  width: number;
  height: number;
}

/**
 * Raised 3D lettering the shop places at a point on the printed model. Customers may change
 * the text and its size; everything else is owned by the shop and snapshotted into orders.
 */
export interface ExtrudedTextLayout {
  /** Anchor in millimeters from the center of the model's footprint: X right, Y toward the back, Z up. */
  x: number;
  y: number;
  z: number;
  /** Which way the lettering faces and is raised: degrees around the vertical axis; 0 faces the front, 90 the right. */
  rotationDeg: number;
  /** Tilt from upright toward facing straight up, in degrees (90 lies flat, e.g. on a lid). */
  tiltDeg: number;
  /** Font size in millimeters at the model's original size; the customer may scale it. */
  sizeMm: number;
  /** How far the letters are raised, in millimeters. */
  depthMm: number;
  /** Distance between lines as a multiple of the size. */
  lineSpacing: number;
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Suggested text, shown and printed unless the customer changes it. */
  defaultText: string;
}

export interface DecorationLayout {
  text?: TextLayout;
  /** Omitted places one undistorted picture on the front (see DEFAULT_TEXTURE_LAYOUT); defined stretches it to this box. */
  texture?: TextureLayout;
  /** Raised 3D lettering at a fixed point; omitted offers none. */
  extrudedText?: ExtrudedTextLayout;
}

/** A differently colored part of a multi-color model file (one per color in the file). */
export interface MeshPart {
  /** Stable identity derived from the file (material/color), used to match triangles to parts. */
  key: string;
  /** Name shown to customers; starts as the material name from the file and can be edited. */
  name: string;
  /** The color the designer gave this part in the file (#rrggbb). */
  fileColor: string;
}

/** A build plate of a slicer project (Bambu Studio / OrcaSlicer 3MF). */
export interface MeshPlate {
  id: number;
  name: string;
  /** Printable object instances on the plate. */
  objectCount: number;
  /** Original dimensions and solid volume of this plate, when analyzed by the editor. */
  model?: ModelSpec;
  /** Color regions used on this plate; omitted on older saved products. */
  parts?: MeshPart[];
  decorationLayout?: DecorationLayout;
}

/** A 3D model file (STL or 3MF) shown in the preview instead of the generic shape. */
export interface MeshFile {
  /** Where the file lives: a site path (bundled demos, `/api/model-files/<id>` uploads) or an https:// URL. */
  url: string;
  format: MeshFormat;
  fileName: string;
  sizeBytes: number;
  triangleCount: number;
  /** Color parts from the file; empty for single-color models (customers then pick one color). */
  parts: MeshPart[];
  /** Plates of a multi-plate slicer project; empty for other files. */
  plates: MeshPlate[];
  /** Legacy single plate (or first selected plate); null when the file has no plates. */
  plate: number | null;
  /** Plates sold together. Omitted on older products, which use `plate`. */
  selectedPlates?: number[];
}

/** The original (unscaled) model that prices are derived from. */
export interface ModelSpec extends Dimensions {
  /** Material volume of the model at original size, in cm³ (from the slicer). */
  volumeCm3: number;
}

export interface ColorOption {
  id: string;
  name: string;
  hex: string;
  priceDelta: number;
}

export interface EngravingLimits {
  /** Total characters allowed, not counting line breaks. */
  maxLength: number;
  /** Lines of text allowed; 1 means a single-line engraving. */
  maxLines: number;
}

export interface EngravingConfig extends EngravingLimits {
  enabled: boolean;
  price: number;
  fonts: string[];
  /** Customers may fill the letters with one of the product's filament colors. */
  colorChoice: boolean;
  /** Added when the letters get their own color (on top of any premium filament surcharge). */
  colorPrice: number;
}

/** A texture image prepared by the shop that customers can choose instead of uploading their own. */
export interface TextureOption {
  id: string;
  name: string;
  /** Uploaded image (`/api/media-files/<id>`) or another site path on the API host. */
  url: string;
}

export interface TextureConfig {
  enabled: boolean;
  /** Charged once per set, whether the texture comes from the library or the customer. */
  price: number;
  /** Shop textures customers can choose from. Omitted on older products, which offer none. */
  options?: TextureOption[];
  /** Customers may upload their own picture. Omitted on older products, which always allowed it. */
  allowCustom?: boolean;
}

export interface ProductMedia {
  type: 'image' | 'video';
  url: string;
  alt: string;
}

/** Current volume-based catalog rates, derived by the API, never saved on a product. */
export interface CatalogPricing {
  ratesPerCm3: Record<PrintMaterial, number>;
  handlingFee: number;
  updatedAt: string | null;
  /** The shop's rates, included for admins (and internally) so sliced variants can be priced. */
  hourlyRate?: number;
  filamentPricePerKg?: Record<PrintMaterial, number>;
  /**
   * Price of every offered print variant at the model's original size (print time × hourly rate +
   * filament × price per kg), keyed by `variantPriceKey`. Lets customers see prices without the
   * shop's measurements.
   */
  variantPrices?: Record<string, number>;
  /**
   * Prices of every offered print variant at the other scales it was sliced at (the product's
   * smallest and largest scale), keyed like `variantPrices`. Prices between them are interpolated.
   */
  variantScalePrices?: Record<string, VariantScalePrice[]>;
}

/** A variant's price (print time and filament at the shop's rates) at a scale of the whole product. */
export interface VariantScalePrice {
  /** Uniform scale factor (1 = original size). */
  scale: number;
  price: number;
}

/** Whether and how far customers may scale a product (uniformly, 1 = original size). */
export interface ProductScaling {
  enabled: boolean;
  /** Smallest and largest scale factor offered; `minScale` ≤ 1 ≤ `maxScale`. */
  minScale: number;
  maxScale: number;
}

/** OrcaSlicer presets a print variant was sliced with (names from the bundled profiles). */
export interface SlicerPresets {
  printer: string;
  process: string;
  filament: string;
}

/**
 * One way of printing a plate (or a model without plates) that customers can choose, e.g. a
 * nozzle, layer height and material. Sliced by the admin; its measurements price the plate at
 * its original size.
 */
export interface PrintVariant {
  id: string;
  /** Shown to customers, e.g. "0.20 mm layers · 0.4 mm nozzle · PLA". */
  label: string;
  presets: SlicerPresets;
  nozzleMm: number;
  layerHeightMm: number;
  material: PrintMaterial;
  /** Print time and filament of one plate at original size: the slicer's result, editable by the admin. */
  measurements: PrintMeasurements;
  /** What the slicer reported, kept for reference when the admin adjusted the measurements. */
  sliced?: PrintMeasurements & { slicedAt: string };
  /**
   * The same plate sliced at other scales of the product (its smallest and largest scale);
   * prices of sizes in between are interpolated. Omitted for products that can't be scaled.
   */
  scaled?: ScaledMeasurements[];
  /** Offered to customers. */
  enabled: boolean;
}

/** Print time and filament of a variant at another uniform scale of the product. */
export interface ScaledMeasurements {
  /** Scale factor (≠ 1). */
  scale: number;
  measurements: PrintMeasurements;
  sliced?: PrintMeasurements & { slicedAt: string };
}

/** The admin's slicing setup of one plate and the variants sliced from it. */
export interface PlateSlicing {
  /** Build plate id; null for a model file without plates. */
  plateId: number | null;
  /** Presets combined into variants (every compatible printer × process × filament). */
  matrix: { printers: string[]; processes: string[]; filaments: string[] };
  /** Generate supports; one setting for every variant of the matrix. */
  support: boolean;
  /** OrcaSlicer options applied to every variant, e.g. { sparse_infill_density: '20%' }. */
  overrides: Record<string, string>;
  variants: PrintVariant[];
  /** Variant preselected for customers; must be an offered one. */
  defaultVariantId: string | null;
}

/** What an order keeps of the chosen print variant. */
export interface PrintVariantSummary {
  id: string;
  label: string;
  nozzleMm: number;
  layerHeightMm: number;
  material: PrintMaterial;
  /** How the shop prints it (omitted in customers' own cart snapshots). */
  presets?: SlicerPresets;
  support?: boolean;
  overrides?: Record<string, string>;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Absent on legacy products, whose descriptions are plain text. */
  descriptionFormat?: 'html';
  /** Additional media shown only in the product carousel. */
  gallery?: ProductMedia[];
  category: string;
  material: string;
  model: ModelSpec;
  /** Legacy original-size price, retained for compatibility; current catalog uses catalogPricing. */
  basePrice: number;
  /**
   * Legacy per-print fee. Current catalog prices exclude it and charge handling once per order.
   */
  fixedFee: number;
  /** Absent in legacy snapshots. Current catalog responses always include these rates. */
  catalogPricing?: CatalogPricing;
  productionDays: number;
  /** Optional photo (URL or data URL) shown in the catalog. */
  imageUrl: string;
  /** Generic preview geometry, used when there is no model file (and for catalog icons). */
  shape: PreviewShape;
  mesh: MeshFile | null;
  published: boolean;
  colors: ColorOption[];
  engraving: EngravingConfig;
  texture: TextureConfig;
  /** Placement for products without build plates; plates keep their own layouts. */
  decorationLayout?: DecorationLayout;
  /**
   * Sliced print variants per plate (or for the whole model). When every included plate offers
   * at least one variant, the print price comes from the chosen variants instead of the volume
   * estimate. Omitted on products without slicing.
   */
  slicing?: PlateSlicing[];
  /**
   * Sizes customers may order. Omitted on older products, which customers can scale within the
   * printer's limits; disabled products are sold at their original size only.
   */
  scaling?: ProductScaling;
  createdAt: string;
  updatedAt: string;
}

/** Choices a customer makes on the product page. */
export interface SurfaceCustomization {
  /** Filament color for single-color models. */
  colorId: string;
  /** For multi-color models: part key → filament color id. Parts not listed keep their file color. */
  partColors: Record<string, string>;
  engravingText: string;
  engravingFont: string;
  /** Filament color for the engraved letters; null leaves them in the print color. */
  engravingColorId: string | null;
  /** Downscaled image (data URL) uploaded by the customer and applied as a relief texture. */
  textureDataUrl: string | null;
  /**
   * Shop texture (`TextureOption.id`) applied instead of an uploaded picture.
   * Omitted when none is chosen, and on cart items and orders that predate the texture library.
   */
  textureId?: string | null;
  /** Replacement for the 3D lettering's suggested text ('' removes the lettering); omitted keeps the suggestion. */
  extrudedText?: string;
  /** 3D lettering size in millimeters; omitted keeps the shop's size. */
  extrudedSizeMm?: number;
  /** Chosen print variant of this plate (products with sliced variants); omitted uses the default. */
  variantId?: string;
}

/** One scale for the set, with independent appearances for its included plates. */
export interface Customization extends SurfaceCustomization {
  dimensions: Dimensions;
  /** Plate id → appearance. Omitted on older cart items, which apply the root appearance to every plate. */
  plates?: Record<string, SurfaceCustomization>;
}

/** Which texture is applied: a snapshot of the shop texture, or the customer's own picture (kept in the customization). */
export type TextureSummary =
  | { source: 'library'; id: string; name: string; url: string }
  | { source: 'custom' };

/** Filament chosen for one color part. `key` (the file part) is omitted on orders placed before it was recorded. */
export interface PartChoice {
  key?: string;
  name: string;
  colorName: string;
  colorHex: string;
}

export interface AppearanceSummary {
  colorName: string;
  colorHex: string;
  engravingColor?: { name: string; hex: string };
  parts?: PartChoice[];
  decorationLayout?: DecorationLayout;
  /** Omitted without a texture, and on orders that predate the texture library. */
  texture?: TextureSummary;
  /** The chosen print variant; omitted for products priced by volume. */
  printVariant?: PrintVariantSummary;
}

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  customization: Customization;
  /** Snapshot of labels so the cart stays readable if the admin edits the product. */
  sizeLabel: string;
  colorName: string;
  colorHex: string;
  /** Text color of the engraving, if the customer chose one. */
  engravingColor?: { name: string; hex: string };
  /** Admin-defined placement snapshot for fulfillment. */
  decorationLayout?: DecorationLayout;
  /** Texture snapshot, so the order still shows it if the shop later edits its texture library. */
  texture?: TextureSummary;
  /** Per-part colors of a multi-color model, as chosen when added to the cart. */
  parts?: PartChoice[];
  /** Print variant of a product without plates (plates keep theirs in their appearance). */
  printVariant?: PrintVariantSummary;
  /** Snapshot of every plate included in this set. */
  plates?: { id: number; name: string; objectCount: number; appearance?: AppearanceSummary }[];
  unitPrice: number;
  quantity: number;
  addedAt: string;
}

/** One line of a price breakdown, e.g. the print itself or an engraving surcharge. */
export interface PriceLine {
  label: string;
  amount: number;
  /** Optional explanation shown under the label, e.g. how the amount was derived. */
  note?: string;
}

/**
 * Every order goes through the same statuses, whatever its models are. Orders with a fixed price
 * usually skip `quoted` and `accepted`; orders that need a quote are `quoted` once the shop has priced them.
 * `queued`: waiting in a printer's queue (see `PrintJob`); `done`: printed, ready to ship.
 */
export const ORDER_STATUSES = [
  'received', 'quoted', 'accepted', 'paid', 'queued', 'printing', 'done', 'shipped', 'delivered', 'rejected', 'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Where an order's models come from — the only thing that differs between orders: configured catalog
 * products, the customer's own files, a project from an external model site, or a Print on Demand product.
 */
export const ORDER_SOURCES = ['catalog', 'upload', 'project', 'printOnDemand'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface Customer {
  name: string;
  email: string;
  phone?: string;
  address: Address;
}

/** Print time and filament of one copy: `key` is a color part of an uploaded model, otherwise a material. */
export interface MeasurementsInput {
  printMinutes: number;
  filaments: { key: string; grams: number }[];
}

/** The customer's own slicing of one copy (uploads), priced when ordering. */
export interface ItemEstimate extends MeasurementsInput {
  unitPrice: number;
}

/**
 * The shop's measurements of one copy (from slicing or entered by hand), priced with the rates at the
 * time: print time × hourly rate + grams × price per kilogram of every filament.
 */
export interface ItemReview {
  printMinutes: number;
  hourlyRate: number;
  printTimeCost: number;
  filaments: { key: string; label: string; grams: number; pricePerKg: number; cost: number }[];
  filamentCost: number;
  unitPrice: number;
  /** What the slicer reported, kept when the admin adjusted the measurements. */
  sliced?: MeasurementsInput & { slicedAt: string };
  reviewedAt: string;
}

/** A configured catalog product: the customer's choices and a readable, priced snapshot. */
export type CatalogModel = { source: 'catalog' } & Omit<CartItem, 'id' | 'addedAt' | 'unitPrice' | 'quantity'> & { priceLines: PriceLine[] };

/** A model file the customer uploaded, with how they want it printed. The file itself is private. */
export interface UploadModel {
  source: 'upload';
  /** Id in the private customer-file store. */
  fileId: string;
  fileName: string;
  /** Detected from the file contents, not from its name. */
  format: MeshFormat;
  sizeBytes: number;
  /** The slicer profile and scale the customer chose; omitted on requests placed before slicing. */
  profile?: CustomerSlicingProfile;
  /** Filament for every color part; omitted on requests placed before print options existed. */
  parts?: PartFilament[];
  /** Nozzle and layer height of requests placed before slicing profiles. */
  nozzle?: NozzleOption;
  layerHeight?: LayerHeightOption;
}

/** One model of an external project (or the whole project, `file` null) with the customer's wishes. */
export interface ProjectModel {
  source: 'project';
  file: ProjectFile | null;
  /** Print size relative to the model's own size. */
  scalePercent: number;
  filaments: FilamentChoice[];
}

/** One set of a Print on Demand product: its models with the customer's colors, and the print variants chosen. */
export interface PrintOnDemandModel {
  source: 'printOnDemand';
  productId: string;
  title: string;
  /** The product's models, each with its copies per set, scale and filaments. */
  models: ProjectOrderItem[];
  /** Sliced products: the scale and the print variant of every plate the shop prints. */
  print?: { scale: number; plates: { plateId: number | null; name: string; variant: PrintVariantSummary }[] };
  /** The customer chose other materials than offered, so the order needs a quote. */
  materialsChanged: boolean;
}

export type ItemModel = CatalogModel | UploadModel | ProjectModel | PrintOnDemandModel;

/** One line of an order. Only `model` depends on the order's source; everything else works alike. */
export interface OrderItem<M extends ItemModel = ItemModel> {
  model: M;
  /** Copies (sets for Print on Demand). */
  quantity: number;
  /** Price of one copy when the order's price is fixed; null while it needs a quote. */
  unitPrice: number | null;
  lineTotal: number | null;
  /** The customer's own slicing estimate (uploads). */
  estimate?: ItemEstimate;
  /** The shop's measurements; prices orders that need a quote, and plans the others. */
  review?: ItemReview;
}

/**
 * An order's price. `fixed`: known when ordering (catalog products, Print on Demand as offered).
 * `quote`: the shop reviews the models and sets the price; the customer's estimate and the shop's
 * measurements help.
 */
export interface OrderPrice {
  mode: 'fixed' | 'quote';
  /** Charged once per order. */
  handlingFee: number;
  /** From the customer's estimates of every item, handling included; null without them. */
  estimated: number | null;
  /** From the shop's measurements of every item with the rates at the time, handling included; null until all are measured. */
  reviewed: number | null;
  /** What the customer pays: fixed when ordering, or the shop's quote; null until quoted. */
  total: number | null;
}

/**
 * An order's place in the queue of a printer of the warehouse: set when the order becomes `queued`,
 * kept while it is `queued` or `printing`, removed with any other status. A printer prints its queue
 * in the order the orders joined it, with a break between prints (`QUEUE_GAP_MINUTES`).
 */
export interface PrintJob {
  printerId: string;
  /** The printer's name when the order was queued (shown if the printer is renamed or gone). */
  printerName: string;
  /** When the order joined the queue: the queue's order. */
  queuedAt: string;
  /** How long the whole order prints, in minutes: the shop's measurements, or entered when queueing. */
  printMinutes: number;
  /** When printing started (status `printing`); null while waiting. */
  startedAt: string | null;
  /** The start estimated when the order was queued, as told to the customer. */
  estimatedStart: string;
  /** The status before queueing, restored when the order is taken out of the queue. */
  previousStatus: OrderStatus;
}

/** The external project of project and Print on Demand orders. */
export interface OrderProject extends ExternalProject {
  /** True when the server fetched the project itself; false when only the customer's copy was available. */
  verified: boolean;
  /** The customer applied one set of settings to every model. */
  sameSettingsForAll: boolean;
}

export interface Order {
  id: string;
  /** Human-friendly reference shown to customers, e.g. PF-261018-K7QX (the prefix names the source). */
  number: string;
  status: OrderStatus;
  source: OrderSource;
  customer: Customer;
  /** The customer's note for the workshop; empty when none. */
  customerNote: string;
  items: OrderItem[];
  /** Project and Print on Demand orders. */
  project?: OrderProject;
  /** The order's place in a printer's queue while it is `queued` or `printing`; null or absent otherwise. */
  printJob?: PrintJob | null;
  price: OrderPrice;
  currency: string;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

/** What the checkout sends; prices are always computed on the server. */
/** External model repositories customers can search and order projects from. */
export const MODEL_SOURCES = ['thingiverse', 'printables', 'makerworld'] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

/** A project (model page) on one of the external sites, as shown and stored by the shop. */
export interface ExternalProject {
  source: ModelSource;
  id: string;
  title: string;
  /** Plain text, possibly shortened; empty when the site provides none. */
  description: string;
  thumbnailUrl: string | null;
  /** HTTPS URL of the original posting on the source site. */
  url: string;
  author: string | null;
  license: string | null;
}

/** One printable file (or print profile) of an external project. */
export interface ProjectFile {
  id: string;
  name: string;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
}

export const PROJECT_MATERIALS = ['any', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'resin'] as const;
export type ProjectMaterial = (typeof PROJECT_MATERIALS)[number];

/** One material in one color; a multi-color or multi-material model has several. */
export interface FilamentChoice {
  material: ProjectMaterial;
  /** Free text such as "matte black"; empty means no preference. */
  color: string;
}

/** The customer's wishes for printing one model of an external project; the shop quotes afterwards. */
export interface ProjectPrintSettings {
  quantity: number;
  /** Print size relative to the model's own size. */
  scalePercent: number;
  /** At least one; several for multi-color / multi-material prints. */
  filaments: FilamentChoice[];
}

/** One model to print: a file of the project, or the whole project (`file: null`) when the site lists no files. */
export interface ProjectOrderItem {
  file: ProjectFile | null;
  settings: ProjectPrintSettings;
}

/** Materials the shop prints with and prices per kilogram ("any" is a customer wish, not a material). */
export const PRINT_MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'resin'] as const;
export type PrintMaterial = (typeof PRINT_MATERIALS)[number];

/** Shop-wide rates for pricing prints from their measurements, edited by the admin in one place. */
export interface PricingSettings {
  /** Price of one hour of printer time. */
  hourlyRate: number;
  /** Charged once per order. */
  handlingFee: number;
  filamentPricePerKg: Record<PrintMaterial, number>;
  updatedAt: string | null;
}

/** What printing takes (e.g. from the slicer): the basis of every project price. */
export interface PrintMeasurements {
  printMinutes: number;
  filaments: { material: PrintMaterial; grams: number }[];
}

/** Print time and filament per material, e.g. of a Print on Demand product. */
export type ProjectReviewInput = PrintMeasurements;

/**
 * A priced print: handling fee + print time × hourly rate + filament used × price per kilogram, with
 * the rates it was calculated with.
 */
export interface ProjectPricing {
  printMinutes: number;
  hourlyRate: number;
  printTimeCost: number;
  filaments: { material: PrintMaterial; grams: number; pricePerKg: number; cost: number }[];
  filamentCost: number;
  handlingFee: number;
  total: number;
  currency: string;
}

/**
 * A reviewed project offered in the shop: the project's models printed as reviewed. Only the
 * measurements of one set are stored; the price is always calculated from them with the shop's
 * current rates (more sets repeat everything except the handling fee).
 */
export interface ProjectProduct {
  id: string;
  title: string;
  description: string;
  published: boolean;
  project: ExternalProject;
  items: ProjectOrderItem[];
  /** Price basis of products without print variants (from the measurements of the project order). */
  measurements: PrintMeasurements;
  /** The project order whose measurements this product was made from. */
  sourceOrder: { id: string; number: string };
  /**
   * The shop's print file with the project's models (STL or a 3MF with plates), uploaded by the
   * admin to slice print variants. Omitted on products without one.
   */
  mesh?: MeshFile | null;
  /** Original size and volume of the print file's included plates, from the admin's analysis. */
  model?: ModelSpec;
  /**
   * Print variants sliced from the print file, per plate, as for catalog products. When every
   * included plate offers one, the price comes from the variants and the scale customers choose.
   */
  slicing?: PlateSlicing[];
  /** Sizes customers may order the whole set in (as for catalog products). */
  scaling?: ProductScaling;
  createdAt: string;
  updatedAt: string;
}

/** A product as admins see it: with its price calculated from the current rates. */
export interface AdminProjectProduct extends ProjectProduct {
  /** Of one set, handling fee included: from the default print variants at the original size when sliced. */
  pricing: ProjectPricing;
}

/** How customers can have a sliced Print on Demand product printed. */
export interface ProjectPrintOptions {
  /** Every included plate of the print file (or the whole file, `plateId` null) and its variants. */
  plates: {
    plateId: number | null;
    name: string;
    defaultVariantId: string | null;
    variants: Pick<PrintVariant, 'id' | 'label' | 'nozzleMm' | 'layerHeightMm' | 'material'>[];
  }[];
  /** Uniform scales of the whole set customers may choose (1 = original size; min = max = 1 for a fixed size). */
  scale: { min: number; max: number };
  /** Size of the set at its original scale. */
  size: Dimensions;
}

/** What customers see of a Print on Demand product: the current price, not the shop's rates or measurements. */
export interface PublicProjectProduct extends Omit<ProjectProduct, 'measurements' | 'sourceOrder' | 'mesh' | 'model' | 'slicing' | 'scaling'> {
  /** Of the default print (default variants, original size). */
  price: { total: number; handlingFee: number; setPrice: number; currency: string };
  /** Present when the product is priced from sliced print variants. */
  printOptions?: ProjectPrintOptions;
}

/** The customer's print variant per plate (`plateId`, or `model` without plates) and scale of a sliced product. */
export interface ProjectPrintChoice {
  /** Uniform scale of the whole set (1 = original size). */
  scale: number;
  variants: Record<string, string>;
}

/** Body of POST /api/project-products/:id/quote. */
export interface ProjectQuoteInput {
  sets: number;
  print?: ProjectPrintChoice;
}

/** The price of a Print on Demand order before it is placed. */
export interface ProjectQuote {
  sets: number;
  setPrice: number;
  handlingFee: number;
  total: number;
  currency: string;
  /** The choice the price is for (sliced products), with withdrawn variants replaced by defaults. */
  print?: ProjectPrintChoice;
  /**
   * One set's price of every offered variant of every plate at the chosen scale (print time and
   * filament of that plate only), for comparing variants: plate key → variant id → price.
   */
  variantPrices?: Record<string, Record<string, number>>;
}

/** Maximum materials/colors per model (what common multi-material printers handle). */
export const MAX_FILAMENTS = 8;

/** One uploaded file of an order: proven by its upload key, with the customer's print choices. */
export interface UploadItemInput {
  fileId: string;
  uploadKey: string;
  quantity: number;
  /** Older storefronts: nozzle and layer height instead of a slicing profile. */
  nozzleId?: string;
  layerHeightId?: string;
  profile?: CustomerSlicingProfile;
  /** The browser's slicing result for one copy; the price estimate shown to the customer. */
  estimate?: MeasurementsInput;
  /** Filament type and color per color part of the model. */
  parts: { key: string; name: string; filamentId: string; colorId: string }[];
}

interface OrderInputBase {
  customer: Customer;
  customerNote?: string;
}

/** What a customer sends to place an order; prices are always computed on the server. */
export type OrderInput = OrderInputBase & (
  | { source?: 'catalog'; items: { productId: string; customization: Customization; quantity: number }[] }
  | { source: 'upload'; items: UploadItemInput[] }
  | {
    source: 'project';
    /** The customer's copy of the project; the server re-fetches it when it can. */
    project: Omit<ExternalProject, 'description' | 'license'>;
    items: { file: Pick<ProjectFile, 'id' | 'name'> | null; settings: ProjectPrintSettings }[];
    sameSettingsForAll: boolean;
  }
  | {
    source: 'printOnDemand';
    productId: string;
    /** How many times the whole product is printed. */
    sets: number;
    /**
     * The customer's materials and colors for every model, in the product's order. Colors are free;
     * a different material makes the order a quote request. Omitted: as offered.
     */
    items?: { fileId: string | null; filaments: FilamentChoice[] }[];
    /** Print variants and scale for products priced from sliced variants; omitted: the defaults at the original size. */
    print?: ProjectPrintChoice;
  }
);

/** The customer's choices for a Print on Demand product (part of its order input). */
export type PrintOnDemandChoices = Extract<OrderInput, { source: 'printOnDemand' }>;

/** A nozzle the shop prints customers' own models with. */
export interface NozzleOption {
  id: string;
  diameterMm: number;
  /** Applied to the filament price: smaller nozzles print slower. */
  priceMultiplier: number;
}

/**
 * A layer height the shop offers. It can be used with a nozzle when it is between a quarter and
 * 0.8 × the nozzle diameter (see `layerFitsNozzle`).
 */
export interface LayerHeightOption {
  id: string;
  heightMm: number;
  /** Applied to the filament price: thinner layers take longer to print. */
  priceMultiplier: number;
}

export interface FilamentColor {
  id: string;
  name: string;
  /** #rrggbb */
  hex: string;
}

/** A filament material (e.g. PLA) with its price and the colors in stock. */
export interface FilamentType {
  id: string;
  name: string;
  /** Short explanation for customers, e.g. "Tough and heat resistant". */
  description: string;
  /** What the shop charges per kilogram of printed filament (USD). */
  pricePerKg: number;
  /** Converts the model's volume to grams. */
  densityGPerCm3: number;
  colors: FilamentColor[];
}

/**
 * Slicer presets (bundled OrcaSlicer profiles, by name) customers combine into the one profile their
 * model is sliced with: a printer, a process made for it and a filament.
 */
export interface CustomerProfiles {
  printers: string[];
  processes: string[];
  filaments: string[];
}

/** The options customers choose from when ordering prints of their own models; edited by the admin. */
export interface PrintSettings {
  /** Offered slicer presets; omitted on settings saved before slicing (the server adds the defaults). */
  profiles?: CustomerProfiles;
  /** Nozzles and layer heights of requests placed before slicing profiles (no longer offered). */
  nozzles: NozzleOption[];
  defaultNozzleId: string;
  layerHeights: LayerHeightOption[];
  /** Must fit the default nozzle. */
  defaultLayerHeightId: string;
  filaments: FilamentType[];
  updatedAt: string;
}

/** A color part of a customer's model with the filament chosen for it, snapshotted at ordering. */
export interface PartFilament {
  /** Part key from the model file; `model` for single-color models. */
  key: string;
  name: string;
  filament: Pick<FilamentType, 'id' | 'name' | 'pricePerKg' | 'densityGPerCm3'>;
  color: FilamentColor;
}

/** What the customer's model is sliced with: one printer, process and filament preset, supports and a scale. */
export interface CustomerSlicingProfile {
  printer: string;
  process: string;
  filament: string;
  support: boolean;
  /** Uniform scale of the model (1 = its size in the file). */
  scale: number;
}

/** Body of POST /api/uploads/estimate: the browser's slicing results to price. */
export interface UploadEstimateInput {
  items: { quantity: number; parts: { key: string; filamentId: string }[]; estimate: MeasurementsInput }[];
}

/** Estimated prices of uploaded models before the order is sent. */
export interface UploadEstimate {
  /** Price of one copy of every item. */
  items: { unitPrice: number }[];
  handlingFee: number;
  total: number;
  currency: string;
}

/** Attachment of an imported email, listed by name (the original .eml file keeps its content). */
export interface EmailAttachment {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface LogEntryBase {
  id: string;
  orderId: string;
  createdAt: string;
}

/** A status change; `from` is null for the status the order was placed with. */
export interface StatusLogEntry extends LogEntryBase {
  type: 'status';
  from: string | null;
  to: string;
}

/**
 * An email the shop sent the customer: automated from a status template (`template` names it),
 * or written by the admin (`template` null). Failed deliveries are logged with their error.
 */
export interface EmailSentLogEntry extends LogEntryBase {
  type: 'emailSent';
  to: string;
  subject: string;
  body: string;
  /** The status whose template was sent; null for the admin's own messages. */
  template: OrderStatus | null;
  /** `outbox`: saved as a file instead of sent (development without SMTP). */
  delivery: 'sent' | 'outbox' | 'failed';
  error?: string;
  messageId: string;
}

/** An email imported from an .eml file, e.g. the customer's reply. The original file is kept. */
export interface EmailImportedLogEntry extends LogEntryBase {
  type: 'emailImported';
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  /** When the email was sent (its Date header), which may differ from when it was imported. */
  sentAt: string;
  messageId?: string;
  attachments: EmailAttachment[];
  /** Id of the original .eml in the private mail-file store. */
  emlFileId: string;
  /** Whether it came from the order's customer address; other senders are flagged in the admin. */
  fromCustomer: boolean;
}

export type LogEntry = StatusLogEntry | EmailSentLogEntry | EmailImportedLogEntry;

export interface EmailTemplate {
  subject: string;
  body: string;
}

/** One email template per order status, the same for every order. */
export interface EmailTemplates {
  templates: Record<OrderStatus, EmailTemplate>;
  updatedAt: string;
}

/** The printer's build volume: the print plate's width and depth and the maximum print height. */
export interface PrintPlate {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

/** A slicer preset archive (ZIP) the admin uploaded for a printer model, with what it contains. */
export interface PrinterProfiles {
  /** Id in the private printer-file store. */
  fileId: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  /** The files in the archive (folders omitted; at most PRINTER_LIMITS.profileEntries are listed). */
  entries: { name: string; sizeBytes: number }[];
  /** Names of the OrcaSlicer/Bambu Studio presets found in the archive's JSON files, by type. */
  presets: { machine: string[]; process: string[]; filament: string[] };
}

/** What the admin sends when adding or editing a printer model; profiles are uploaded separately. */
export interface PrinterModelInput {
  /** Unique among the models (case-insensitive), e.g. "Snapmaker U1". */
  name: string;
  manufacturer: string;
  plate: PrintPlate;
  /** Filaments one print job can use (e.g. with the model's multi-material unit). */
  maxColors: number;
}

/**
 * A printer model of the warehouse. Its print plate, colors and slicer profiles apply to every
 * printer of the model: printers only refer to it, so a change shows on all of them.
 */
export interface PrinterModel extends PrinterModelInput {
  id: string;
  profiles: PrinterProfiles | null;
  createdAt: string;
  updatedAt: string;
}

/** A model as the admin API returns it: with the printers of that model. */
export interface PrinterModelWithPrinters extends PrinterModel {
  printers: { id: string; name: string }[];
}

/** A known printer the admin can start a new model from (built into the server). */
export type PrinterModelTemplate = PrinterModelInput;

/** What the admin sends when adding or editing a printer. */
export interface PrinterInput {
  /** Unique within the workshop (case-insensitive), e.g. "U1-01". */
  name: string;
  /** The printer's model: its plate size, colors and profiles. */
  modelId: string;
  /** Where the printer stands, e.g. "Room 2, rack B, shelf 3". */
  location: string;
  notes: string;
}

/** A printer in the workshop (the printers warehouse). */
export interface Printer extends PrinterInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** A printer as the admin API returns it: with its model's current values (null if the model is gone). */
export interface PrinterWithModel extends Printer {
  model: PrinterModel | null;
  /** The printer's queue at a glance. */
  queue: PrinterQueueSummary;
}

/** A printer's queue at a glance. */
export interface PrinterQueueSummary {
  /** Orders waiting or printing. */
  length: number;
  /** When an order queued now would start: the last print's estimated end plus the break, or now when idle. */
  nextStart: string;
}

/** One order in a printer's queue, with its estimated times. */
export interface QueueEntry {
  /** 1 = printing or next. */
  position: number;
  order: Pick<Order, 'id' | 'number' | 'status' | 'source' | 'createdAt'> & {
    customerName: string;
    /** What is printed, e.g. "2 × Spiral Vase, planter.stl × 1". */
    models: string;
  };
  printJob: PrintJob;
  estimatedStart: string;
  estimatedEnd: string;
}

/** A printer's queue: printing first, then the waiting orders in the order they joined. */
export interface PrinterQueue {
  printer: PrinterWithModel;
  entries: QueueEntry[];
  /** The break between two prints, in minutes. */
  gapMinutes: number;
}
