import { t } from '../i18n';
import type { ReactNode } from 'react';
import type { Customer } from '../types';

export const emptyCustomer: Customer = {
  name: '',
  email: '',
  phone: '',
  address: { line1: '', line2: '', city: '', postalCode: '', country: '' },
};

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'checkout__wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

interface Props {
  customer: Customer;
  onChange: (update: (customer: Customer) => Customer) => void;
}

/** Contact and shipping inputs, laid out in the parent's `checkout__grid`. */
export function CustomerFields({ customer, onChange }: Props) {
  const setField = (field: 'name' | 'email' | 'phone', value: string) => onChange((c) => ({ ...c, [field]: value }));
  const setAddress = (field: keyof Customer['address'], value: string) =>
    onChange((c) => ({ ...c, address: { ...c.address, [field]: value } }));
  const { address } = customer;
  return (
    <>
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
    </>
  );
}

/** Optional fields are left out rather than sent empty. */
export function customerForSubmission(customer: Customer): Customer {
  return {
    ...customer,
    phone: customer.phone?.trim() || undefined,
    address: { ...customer.address, line2: customer.address.line2?.trim() || undefined },
  };
}

export const customerForApi = customerForSubmission;

/** Shows an API error with its per-field or per-item details. */
export function ErrorBanner({ message, details }: { message: string; details: string[] }) {
  return (
    <div className="banner banner--error" role="alert">
      <strong>{message}</strong>
      {details.length > 0 && (
        <ul>
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
