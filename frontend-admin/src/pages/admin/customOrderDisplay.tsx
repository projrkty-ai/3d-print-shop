import { formatNumber, t } from '../../i18n';
import type { CustomOrder, CustomOrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';

export const CUSTOM_STATUS_LABELS: Record<CustomOrderStatus, string> = {
  submitted: t("Awaiting review"),
  approved: t("Approved"),
  rejected: t("Rejected"),
  printing: t("Printing"),
  shipped: t("Shipped"),
  delivered: t("Delivered"),
  cancelled: t("Cancelled"),
};

export function CustomOrderStatusBadge({ status }: { status: CustomOrderStatus }) {
  return <span className={`status-badge status-badge--${status}`}>{CUSTOM_STATUS_LABELS[status]}</span>;
}

export const totalCopies = (order: CustomOrder) => order.files.reduce((sum, file) => sum + file.quantity, 0);

export const formatQuote = (quote: number | null) => (quote === null ? t("Not quoted") : formatPrice(quote));

/** File sizes as customers see them, e.g. "820 KB" or "12.5 MB". */
export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`
    : `${formatNumber(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
}
