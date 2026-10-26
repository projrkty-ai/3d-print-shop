import { t } from '../../i18n';
import { LOCALE } from '../../config';
import type { OrderStatus } from '../../types';

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

const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
