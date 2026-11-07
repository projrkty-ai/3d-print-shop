import { t } from '../i18n';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { CustomerFields, customerForSubmission, emptyCustomer, ErrorBanner, Field } from '../components/CustomerFields';
import type { CartItem, Customer, Order } from '../types';

interface Props {
  items: CartItem[];
  onPlaced: (order: Order) => void;
  onCancel: () => void;
}

/** Collects contact and shipping details and places the order; prices are set by the server. */
export function CheckoutForm({ items, onPlaced, onCancel }: Props) {
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const order = await api.createOrder({
        customer: customerForSubmission(customer),
        items: items.map(({ productId, customization, quantity }) => ({ productId, customization, quantity })),
        customerNote: note.trim() || undefined,
      });
      onPlaced(order);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, t("Could not place the order.")));
      setSubmitting(false);
    }
  }

  return (
    <form className="card checkout" onSubmit={(e) => void handleSubmit(e)}>
      <h2>{t("Checkout")}</h2>
      <div className="checkout__grid">
        <CustomerFields customer={customer} onChange={setCustomer} />
        <Field label={t("Note for the workshop (optional)")} wide>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </div>

      {error && <ErrorBanner message={error.message} details={error.details} />}

      <p className="muted">{t("No payment is taken online — the shop will contact you to confirm the order and arrange payment.")}</p>
      <div className="checkout__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={submitting}>
          {t("Back")}
        </button>
        <button type="submit" className="btn btn--primary btn--large" disabled={submitting}>
          {submitting ? t("Placing order…") : t("Place order")}
        </button>
      </div>
    </form>
  );
}
