import { formatNumber, t } from '../../i18n';
import { LOCALE } from '../../config';
import type { ModelSource, Order, OrderSource, OrderStatus, ProjectMaterial } from '../../types';
import type { UploadFile } from '../../utils/printEstimate';
import { formatPrice } from '../../utils/pricing';

/** The statuses every order shares, whatever its models' source. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  received: t("Received"),
  quoted: t("Quoted"),
  accepted: t("Accepted"),
  paid: t("Paid"),
  queued: t("In queue"),
  printing: t("Printing"),
  done: t("Done"),
  shipped: t("Shipped"),
  delivered: t("Delivered"),
  rejected: t("Rejected"),
  cancelled: t("Cancelled"),
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-badge--${status}`}>{STATUS_LABELS[status]}</span>;
}

/** Where an order's models come from: the only thing that differs between orders. */
export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  catalog: t("Catalog"),
  upload: t("Customer's models"),
  project: t("External project"),
  printOnDemand: t("Print on Demand"),
};

export function OrderSourceBadge({ source }: { source: OrderSource }) {
  return <span className={`order-source order-source--${source}`}>{ORDER_SOURCE_LABELS[source]}</span>;
}

/** External model sites. */
export const SOURCE_LABELS: Record<ModelSource, string> = { thingiverse: 'Thingiverse', printables: 'Printables', makerworld: 'MakerWorld' };

export const MATERIAL_LABELS: Record<ProjectMaterial, string> = {
  any: t("No preference"), PLA: 'PLA', PETG: 'PETG', ABS: 'ABS', ASA: 'ASA', TPU: t("TPU (flexible)"), resin: t("Resin"),
};

const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** File sizes as customers see them, e.g. "820 KB" or "12.5 MB". */
export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`
    : `${formatNumber(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
}

/** Copies of every item (sets for Print on Demand). */
export const totalCopies = (order: Pick<Order, 'items'>) => order.items.reduce((sum, item) => sum + item.quantity, 0);

/** The order's price, or that it still needs one. */
export const formatOrderPrice = (order: Pick<Order, 'price'>) => (order.price.total === null ? t("Not quoted") : formatPrice(order.price.total));

/** The customer's uploaded files of an order (uploads only). */
export const uploadFiles = (order: Pick<Order, 'items'>): UploadFile[] =>
  order.items.flatMap(({ model, quantity }) => (model.source === 'upload' ? [{ ...model, quantity }] : []));
