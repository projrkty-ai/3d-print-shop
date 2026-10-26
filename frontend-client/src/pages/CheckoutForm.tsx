import { t } from '../i18n';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { CartItem, Customer, Order } from '../types';

interface Props {
  items: CartItem[];
  onPlaced: (order: Order) => void;
  onCancel: () => void;
}

const emptyCustomer: Customer = {
  name: '',
  email: '',
  phone: '',
  address: { line1: '', line2: '', city: '', postalCode: '', country: '' },
};

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'checkout__wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Collects contact and shipping details and places the order; prices are set by the server. */
export function CheckoutForm({ items, onPlaced, onCancel }: Props) {
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const setField = (field: 'name' | 'email' | 'phone', value: string) => setCustomer((c) => ({ ...c, [field]: value }));
  const setAddress = (field: keyof Customer['address'], value: string) =>
    setCustomer((c) => ({ ...c, address: { ...c.address, [field]: value } }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const order = await api.createOrder({
        customer: {
          ...customer,
          // Optional fields are left out rather than sent empty.
          phone: customer.phone?.trim() || undefined,
          address: { ...customer.address, line2: customer.address.line2?.trim() || undefined },
        },
        items: items.map(({ productId, customization, quantity }) => ({ productId, customization, quantity })),
        customerNote: note.trim() || undefined,
      });
      onPlaced(order);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, t("Could not place the order.")));
      setSubmitting(false);
    }
  }

  const { address } = customer;
  return (
    <form className="card checkout" onSubmit={(e) => void handleSubmit(e)}>
      <h2>{t("Checkout")}</h2>
      <div className="checkout__grid">
        <Field label={t("Full name")}>
          <input required value={customer.name} onChange={(e) => setField('name', e.target.value)} autoComplete="name" />
        </Field>
        <Field label={t("Email")}>
          <input required type="email" value={customer.email} onChange={(e) => setField('email', e.target.value)} autoComplete="email" />
        </Field>
        <Field label={t("Phone (optional)")}>
          <input type="tel" value={customer.phone} onChange={(e) => setField('phone', e.target.value)} autoComplete="tel" />
        </Field>
        <Field label={t("Address")} wide>
          <input required value={address.line1} onChange={(e) => setAddress('line1', e.target.value)} autoComplete="address-line1" />
        </Field>
        <Field label={t("Apartment, suite, etc. (optional)")} wide>
          <input value={address.line2} onChange={(e) => setAddress('line2', e.target.value)} autoComplete="address-line2" />
        </Field>
        <Field label={t("City")}>
          <input required value={address.city} onChange={(e) => setAddress('city', e.target.value)} autoComplete="address-level2" />
        </Field>
        <Field label={t("Postal code")}>
          <input required value={address.postalCode} onChange={(e) => setAddress('postalCode', e.target.value)} autoComplete="postal-code" />
        </Field>
        <Field label={t("Country")}>
          <input required value={address.country} onChange={(e) => setAddress('country', e.target.value)} autoComplete="country-name" />
        </Field>
        <Field label={t("Note for the workshop (optional)")} wide>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </div>

      {error && (
        <div className="banner banner--error" role="alert">
          <strong>{error.message}</strong>
          {error.details.length > 0 && (
            <ul>
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

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
