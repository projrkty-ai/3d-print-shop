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
/** External model repositories customers can order projects from. */
export type ModelSource = 'thingiverse' | 'printables' | 'makerworld';

export interface ExternalProject {
  source: ModelSource;
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  /** The original posting on the source site. */
  url: string;
  author: string | null;
  license: string | null;
}

export interface ProjectFile {
  id: string;
  name: string;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
}

export const PROJECT_ORDER_STATUSES = ['new', 'quoted', 'accepted', 'printing', 'shipped', 'cancelled'] as const;
export type ProjectOrderStatus = (typeof PROJECT_ORDER_STATUSES)[number];

export type ProjectMaterial = 'any' | 'PLA' | 'PETG' | 'ABS' | 'ASA' | 'TPU' | 'resin';

export interface FilamentChoice {
  material: ProjectMaterial;
  /** Free text; empty means no preference. */
  color: string;
}

export interface ProjectPrintSettings {
  quantity: number;
  scalePercent: number;
  /** Several for multi-color / multi-material prints. */
  filaments: FilamentChoice[];
}

/** One model to print; `file: null` is the whole project (the site listed no files). */
export interface ProjectOrderItem {
  file: ProjectFile | null;
  settings: ProjectPrintSettings;
}

/** A customer's request to print a project from an external model site; the shop quotes and fulfils it. */
export interface ProjectOrder {
  id: string;
  number: string;
  status: ProjectOrderStatus;
  customer: Customer;
  project: ExternalProject;
  /** False when the server could not fetch the project and kept the customer's copy. */
  projectVerified: boolean;
  items: ProjectOrderItem[];
  /** The customer used one selection for all models. */
  sameSettingsForAll: boolean;
  notes: string;
  adminNote: string;
  /** True while the shop has to quote: only then may the price change. */
  requiresQuote: boolean;
  /** The order's price: fixed when a ready-to-print product was ordered, the shop's quote otherwise. */
  review?: ProjectReview;
  /** Set when the customer ordered a ready-to-print product; `materialsChanged` made it a quote request. */
  product?: { id: string; title: string; sets: number; materialsChanged: boolean };
  createdAt: string;
  updatedAt: string;
}

/** Materials the shop prices per kilogram. */
export const PRINT_MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'resin'] as const;
export type PrintMaterial = (typeof PRINT_MATERIALS)[number];

/** Shop-wide rates for pricing project orders (`GET/PUT /settings/pricing`). */
export interface PricingSettings {
  hourlyRate: number;
  handlingFee: number;
  filamentPricePerKg: Record<PrintMaterial, number>;
  /** Null while the server's defaults are in use. */
  updatedAt: string | null;
}

export interface ProjectReviewInput {
  printMinutes: number;
  filaments: { material: PrintMaterial; grams: number }[];
}

/** handling fee + print time × hourly rate + filament used × price per kg, with the rates used. */
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
 * A reviewed project offered to customers. Only the measurements of one set are stored; `pricing` is
 * calculated by the server from them with the current rates on every request.
 */
export interface ProjectProduct {
  id: string;
  title: string;
  description: string;
  published: boolean;
  project: ExternalProject;
  items: ProjectOrderItem[];
  measurements: ProjectReviewInput;
  pricing: ProjectPricing;
  sourceOrder: { id: string; number: string };
  createdAt: string;
  updatedAt: string;
}

export interface OrderInput {
  customer: Customer;
  items: { productId: string; customization: Customization; quantity: number }[];
  customerNote?: string;
}

/** Print requests for customers' own STL/3MF files; reviewed and priced by the shop. */
export const CUSTOM_ORDER_STATUSES = ['submitted', 'approved', 'rejected', 'printing', 'shipped', 'delivered', 'cancelled'] as const;
export type CustomOrderStatus = (typeof CUSTOM_ORDER_STATUSES)[number];

export interface NozzleOption {
  id: string;
  diameterMm: number;
  /** Applied to the filament price: smaller nozzles print slower. */
  priceMultiplier: number;
}

/** Usable with a nozzle from a quarter to 0.8 × its diameter. */
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

/** A filament material with the shop's price and the colors in stock. */
export interface FilamentType {
  id: string;
  name: string;
  description: string;
  /** What the shop charges per kilogram of printed filament (USD). */
  pricePerKg: number;
  densityGPerCm3: number;
  colors: FilamentColor[];
}

/** What customers choose from for prints of their own models (GET/PUT /api/print-settings). */
export interface PrintSettings {
  nozzles: NozzleOption[];
  defaultNozzleId: string;
  layerHeights: LayerHeightOption[];
  /** Must fit the default nozzle. */
  defaultLayerHeightId: string;
  filaments: FilamentType[];
  updatedAt: string;
}

/** The filament a customer chose for one color part, snapshotted with its price. */
export interface PartFilament {
  /** Part key from the model file; `model` for single-color models. */
  key: string;
  name: string;
  filament: Pick<FilamentType, 'id' | 'name' | 'pricePerKg' | 'densityGPerCm3'>;
  color: FilamentColor;
}

/** One uploaded model of a request. The file is private: download it through the admin API. */
export interface CustomOrderFile {
  fileId: string;
  fileName: string;
  format: MeshFormat;
  sizeBytes: number;
  quantity: number;
  /** Omitted on requests placed before the current print options existed. */
  nozzle?: NozzleOption;
  layerHeight?: LayerHeightOption;
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
  /** Price offered after review; null until quoted. */
  quotedPrice: number | null;
  currency: string;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

/** The two kinds of orders with a log book. */
export type OrderKind = 'order' | 'customOrder';

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

/** An email sent to the customer: from a status template, or written by the admin (`template` null). */
export interface EmailSentLogEntry extends LogEntryBase {
  type: 'emailSent';
  to: string;
  subject: string;
  body: string;
  template: EmailTemplateKey | null;
  /** `outbox`: saved as a file on the server instead of sent (development without SMTP). */
  delivery: 'sent' | 'outbox' | 'failed';
  error?: string;
  messageId: string;
}

/** An email imported from an .eml file, e.g. the customer's reply. */
export interface EmailImportedLogEntry extends LogEntryBase {
  type: 'emailImported';
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  messageId?: string;
  attachments: { fileName: string; contentType: string; sizeBytes: number }[];
  emlFileId: string;
  /** False when it came from another address than the customer's. */
  fromCustomer: boolean;
}

export type LogEntry = StatusLogEntry | EmailSentLogEntry | EmailImportedLogEntry;

export type EmailTemplateKey = `order.${OrderStatus}` | `customOrder.${CustomOrderStatus}`;

export interface EmailTemplate {
  subject: string;
  body: string;
}

/** GET /api/email-templates: the templates, the defaults, and each template's variables. */
export interface EmailTemplatesResponse {
  templates: Record<EmailTemplateKey, EmailTemplate>;
  defaults: Record<EmailTemplateKey, EmailTemplate>;
  definitions: Record<EmailTemplateKey, { kind: OrderKind; status: string; label: string; variables: string[]; required: string[] }>;
  updatedAt: string;
}

/** The status email a status change would send; `missing` lists the `required` values without one. */
export interface StatusEmailPreview extends EmailTemplate {
  to: string;
  template: EmailTemplateKey;
  required: string[];
  missing: string[];
}

/** How the server delivers customer emails. */
export interface MailDelivery {
  transport: 'smtp' | 'outbox' | 'disabled';
  from: string;
}
