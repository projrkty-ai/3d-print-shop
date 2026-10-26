import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAdminAuth } from '../../store/AdminAuthContext';

/** Wraps every admin page: asks for the admin key first, then shows the section tabs. */
export function AdminLayout() {
  const { isAdmin, signOut } = useAdminAuth();
  const { pathname } = useLocation();
  if (!isAdmin) return <AdminSignIn />;

  const onOrders = pathname.startsWith('/admin/orders');
  return (
    <div className="admin-shell">
      <nav className="admin-tabs" aria-label={t("Admin sections")}>
        <Link to="/admin" className={onOrders ? '' : 'is-active'} aria-current={onOrders ? undefined : 'page'}>{t("Products")}</Link>
        <Link to="/admin/orders" className={onOrders ? 'is-active' : ''} aria-current={onOrders ? 'page' : undefined}>{t("Orders")}</Link>
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
