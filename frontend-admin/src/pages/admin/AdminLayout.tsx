import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAdminAuth } from '../../store/AdminAuthContext';

/** Wraps every admin page: asks for the admin key first, then shows the section tabs. */
export function AdminLayout() {
  const { isAdmin, signOut } = useAdminAuth();
  const { pathname } = useLocation();
  if (!isAdmin) return <AdminSignIn />;

  const section = pathname.startsWith('/admin/orders') ? 'orders'
    : pathname.startsWith('/admin/custom-orders') ? 'custom-orders'
      : pathname.startsWith('/admin/email-templates') ? 'email-templates' : pathname.startsWith('/admin/project-orders') ? 'project-orders'
          : pathname.startsWith('/admin/ready-to-print') ? 'ready-to-print'
            : pathname.startsWith('/admin/pricing') ? 'pricing' : 'products';
  const tab = (name: typeof section) => ({
    className: section === name ? 'is-active' : '',
    'aria-current': section === name ? ('page' as const) : undefined,
  });
  return (
    <div className="admin-shell">
      <nav className="admin-tabs" aria-label={t("Admin sections")}>
        <Link to="/admin" {...tab('products')}>{t("Products")}</Link>
        <Link to="/admin/orders" {...tab('orders')}>{t("Orders")}</Link>
        <Link to="/admin/custom-orders" {...tab('custom-orders')}>{t("Print requests")}</Link>
        <Link to="/admin/email-templates" {...tab('email-templates')}>{t("Email templates")}</Link>
        <Link to="/admin/project-orders" {...tab('project-orders')}>{t("Project orders")}</Link>
        <Link to="/admin/ready-to-print" {...tab('ready-to-print')}>{t("Ready to print")}</Link>
        <Link to="/admin/pricing" {...tab('pricing')}>{t("Pricing")}</Link>
        <button type="button" className="btn btn--small btn--ghost admin-tabs__signout" onClick={signOut}>{t("Sign out")}</button>
      </nav>
      <Outlet />
    </div>
  );
}

function AdminSignIn() {
  const { signIn } = useAdminAuth();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setChecking(true);
    try {
      if (!(await signIn(key))) setError(t("That key isn't right."));
    } catch {
      setError(t("Can't reach the shop server. Is it running?"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <form className="card admin-signin" onSubmit={(e) => void handleSubmit(e)}>
      <h1>{t("Admin sign-in")}</h1>
      <p className="muted">{t("Enter the admin key (the server's ADMIN_TOKEN) to manage products and orders.")}</p>
      <label className="field">
        <span>{t("Admin key")}</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      {error && (
        <p className="field__help is-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--primary" disabled={checking || !key.trim()}>
        {checking ? t("Checking…") : t("Sign in")}
      </button>
    </form>
  );
}
