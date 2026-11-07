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

export const ORDER_STATUSES = ['pending', 'paid', 'printing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

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

/** A configured product as ordered: the customer's choices plus a readable, priced snapshot. */
export type OrderItem = Omit<CartItem, 'id' | 'addedAt'> & {
  priceLines: PriceLine[];
  lineTotal: number;
};

export interface Order {
  id: string;
  /** Human-friendly reference shown to customers, e.g. PF-261018-K7QX. */
  number: string;
  status: OrderStatus;
  customer: Customer;
  items: OrderItem[];
  total: number;
  /** Charged once per order; absent on orders placed before dynamic catalog pricing. */
  handlingFee?: number;
  currency: string;
  customerNote?: string;
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

export const PROJECT_ORDER_STATUSES = ['new', 'quoted', 'accepted', 'printing', 'shipped', 'cancelled'] as const;
export type ProjectOrderStatus = (typeof PROJECT_ORDER_STATUSES)[number];

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

/** A customer's request to print an external project: reviewed, quoted and fulfilled by the shop. */
export interface ProjectOrder {
  id: string;
  /** Human-friendly reference, e.g. PJ-261106-K7QX. */
  number: string;
  status: ProjectOrderStatus;
  customer: Customer;
  project: ExternalProject;
  /** True when the server fetched the project itself; false when only the customer's copy was available. */
  projectVerified: boolean;
  items: ProjectOrderItem[];
  /** The customer applied one set of settings to every model (each item still carries them). */
  sameSettingsForAll: boolean;
  /** The customer's note for the workshop. */
  notes: string;
  adminNote: string;
  /**
   * True when the shop still has to quote: projects found by search, and ready-to-print products whose
   * materials the customer changed. Only these orders' price may change after they are placed.
   */
  requiresQuote: boolean;
  /**
   * The order's price entry: measurements and the price calculated from them with the shop's rates.
   * Set when a fixed-price order is placed, and by the admin's review for orders that need a quote.
   */
  review?: ProjectReview;
  /** Set when the order was placed for a ready-to-print product; `materialsChanged` made it a quote. */
  product?: { id: string; title: string; sets: number; materialsChanged: boolean };
  createdAt: string;
  updatedAt: string;
}

/** Materials the shop prints with and prices per kilogram ("any" is a customer wish, not a material). */
export const PRINT_MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'resin'] as const;
export type PrintMaterial = (typeof PRINT_MATERIALS)[number];

/** Shop-wide rates for pricing project orders, edited by the admin in one place. */
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

/** Body of the review endpoint: the measurements of one project order. */
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

export interface ProjectReview extends ProjectPricing {
  reviewedAt: string;
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
  measurements: PrintMeasurements;
  /** The project order whose review this product was made from. */
  sourceOrder: { id: string; number: string };
  createdAt: string;
  updatedAt: string;
}

/** A product as admins see it: with its price calculated from the current rates. */
export interface AdminProjectProduct extends ProjectProduct {
  pricing: ProjectPricing;
}

/** What customers see of a ready-to-print product: the current price, not the shop's rates or measurements. */
export interface PublicProjectProduct extends Omit<ProjectProduct, 'measurements' | 'sourceOrder'> {
  price: { total: number; handlingFee: number; setPrice: number; currency: string };
}

export interface ProjectProductOrderInput {
  customer: Customer;
  /** How many times the whole product is printed. */
  sets: number;
  notes: string;
  /**
   * The customer's materials and colors for every model, in the product's order. Colors are free;
   * a different material makes the order a quote request. Omitted: as offered.
   */
  items?: { fileId: string | null; filaments: FilamentChoice[] }[];
}

export interface ProjectOrderInput {
  customer: Customer;
  /** The customer's copy of the project; the server re-fetches it when it can. */
  project: Omit<ExternalProject, 'description' | 'license'>;
  items: { file: Pick<ProjectFile, 'id' | 'name'> | null; settings: ProjectPrintSettings }[];
  sameSettingsForAll: boolean;
  notes: string;
}

/** Maximum materials/colors per model (what common multi-material printers handle). */
export const MAX_FILAMENTS = 8;

export interface OrderInput {
  customer: Customer;
  items: { productId: string; customization: Customization; quantity: number }[];
  customerNote?: string;
}

/**
 * Print requests for the customer's own STL/3MF files. Unlike catalog orders they have no price
 * when submitted: the shop reviews the files first, then approves (usually with a quote) or rejects.
 */
export const CUSTOM_ORDER_STATUSES = ['submitted', 'approved', 'rejected', 'printing', 'shipped', 'delivered', 'cancelled'] as const;
export type CustomOrderStatus = (typeof CUSTOM_ORDER_STATUSES)[number];

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

/** The options customers choose from when ordering prints of their own models; edited by the admin. */
export interface PrintSettings {
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

/** One uploaded model of a print request. The file itself is private (admin download only). */
export interface CustomOrderFile {
  /** Id in the private customer-file store. */
  fileId: string;
  fileName: string;
  /** Detected from the file contents, not from its name. */
  format: MeshFormat;
  sizeBytes: number;
  /** Copies to print. */
  quantity: number;
  /** Chosen nozzle and layer height; omitted on requests placed before print options existed. */
  nozzle?: NozzleOption;
  layerHeight?: LayerHeightOption;
  /** Filament for every color part; omitted on requests placed before print options existed. */
  parts?: PartFilament[];
}

export interface CustomOrder {
  id: string;
  /** Human-friendly reference shown to customers, e.g. CP-261018-K7QX. */
  number: string;
  status: CustomOrderStatus;
  customer: Customer;
  files: CustomOrderFile[];
  customerNote?: string;
  /** Price offered by the shop after reviewing the files; null until quoted. */
  quotedPrice: number | null;
  currency: string;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

/** What the customer confirms: contact details plus files uploaded beforehand, proven by their upload keys. */
export interface CustomOrderInput {
  customer: Customer;
  files: {
    fileId: string;
    uploadKey: string;
    quantity: number;
    nozzleId: string;
    layerHeightId: string;
    /** Filament type and color per color part of the model. */
    parts: { key: string; name: string; filamentId: string; colorId: string }[];
  }[];
  customerNote?: string;
}

/** The two kinds of orders that have a log book: catalog orders and print requests. */
export type OrderKind = 'order' | 'customOrder';

/** Attachment of an imported email, listed by name (the original .eml file keeps its content). */
export interface EmailAttachment {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface LogEntryBase {
  id: string;
  orderKind: OrderKind;
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
  template: EmailTemplateKey | null;
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

/** One email template per status of each order kind, e.g. `customOrder.approved`. */
export type EmailTemplateKey = `order.${OrderStatus}` | `customOrder.${CustomOrderStatus}`;

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface EmailTemplates {
  templates: Record<EmailTemplateKey, EmailTemplate>;
  updatedAt: string;
}
