import { t } from '../../i18n';
import { LOCALE } from '../../config';
import type { ModelSource, OrderStatus, ProjectMaterial, ProjectOrderStatus } from '../../types';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: t("Pending"),
  paid: t("Paid"),
  printing: t("Printing"),
  shipped: t("Shipped"),
  delivered: t("Delivered"),
  cancelled: t("Cancelled"),
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-badge--${status}`}>{STATUS_LABELS[status]}</span>;
}

export const PROJECT_STATUS_LABELS: Record<ProjectOrderStatus, string> = {
  new: t("New"),
  quoted: t("Quoted"),
  accepted: t("Accepted"),
  printing: t("Printing"),
  shipped: t("Shipped"),
  cancelled: t("Cancelled"),
};

export function ProjectOrderStatusBadge({ status }: { status: ProjectOrderStatus }) {
  return <span className={`status-badge status-badge--${status}`}>{PROJECT_STATUS_LABELS[status]}</span>;
}

export const SOURCE_LABELS: Record<ModelSource, string> = { thingiverse: 'Thingiverse', printables: 'Printables', makerworld: 'MakerWorld' };

export const MATERIAL_LABELS: Record<ProjectMaterial, string> = {
  any: t("No preference"), PLA: 'PLA', PETG: 'PETG', ABS: 'ABS', ASA: 'ASA', TPU: t("TPU (flexible)"), resin: t("Resin"),
};

const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
