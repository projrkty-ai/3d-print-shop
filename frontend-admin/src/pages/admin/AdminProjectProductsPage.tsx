import { t } from '../../i18n';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { ProjectProduct } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { formatDateTime, SOURCE_LABELS } from './orderDisplay';
import { useAdminData } from './useAdminData';

/** Reviewed projects offered at a fixed price in the shop's "Ready to print" tab. */
export function AdminProjectProductsPage() {
  const { state, setData, reload } = useAdminData(() => api.listProjectProducts(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(product: ProjectProduct, action: () => Promise<ProjectProduct[]>) {
    setBusyId(product.id);
    setError(null);
    try {
      setData(await action());
    } catch (err) {
      setError(`${product.title}: ${err instanceof ApiError ? err.message : t("Something went wrong.")}`);
    } finally {
      setBusyId(null);
    }
  }

  if (state.status !== 'ready') return <div className="admin"><LoadState load={state} onRetry={reload} loadingText={t("Loading ready-to-print products…")} /></div>;
  const products = state.data;
  const togglePublished = (product: ProjectProduct, published: boolean) => run(product, async () => {
    const updated = await api.updateProjectProduct(product.id, { published });
    return products.map((p) => (p.id === updated.id ? updated : p));
  });
  const remove = (product: ProjectProduct) => {
    if (!window.confirm(t("Delete \"{0}\"? This cannot be undone.", product.title))) return;
    void run(product, async () => {
      await api.deleteProjectProduct(product.id);
      return products.filter((p) => p.id !== product.id);
    });
  };

  return (
    <div className="admin">
      <div className="admin__header">
        <div>
          <h1>{t("Ready to print")}</h1>
          <p className="muted">{t("Create these from a reviewed project order. Customers order them at the price shown.")}</p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost" onClick={reload}>{t("Refresh")}</button>
        </div>
      </div>
      {error && <p className="banner banner--error" role="alert">{error}</p>}
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Product")}</th>
              <th>{t("Price")}</th>
              <th>{t("Models")}</th>
              <th>{t("Created")}</th>
              <th>{t("Published")}</th>
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="admin-table__product">
                    <span className="admin-table__thumbnail">
                      {product.project.thumbnailUrl && <img src={product.project.thumbnailUrl} alt="" referrerPolicy="no-referrer" />}
                    </span>
                    <div>
                      <Link to={`/admin/ready-to-print/${product.id}`} className="admin-table__name">{product.title}</Link>
                      <div className="muted">{SOURCE_LABELS[product.project.source]} · {t("from {0}", product.sourceOrder.number)}</div>
                    </div>
                  </div>
                </td>
                <td>{formatPrice(product.pricing.total)}</td>
                <td>{product.items.some((item) => item.file) ? product.items.length : t("Whole project")}</td>
                <td>{formatDateTime(product.createdAt)}</td>
                <td>
                  <label className="toggle">
                    <input type="checkbox" checked={product.published} disabled={busyId === product.id}
                      onChange={(e) => void togglePublished(product, e.target.checked)} aria-label={t("Published: {0}", product.title)} />
                    <span />
                  </label>
                </td>
                <td>
                  <div className="admin-table__actions">
                    <Link to={`/admin/ready-to-print/${product.id}`} className="btn btn--small">{t("Edit")}</Link>
                    <button type="button" className="btn btn--small btn--ghost btn--danger" disabled={busyId === product.id}
                      onClick={() => remove(product)}>{t("Delete")}</button>
                  </div>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="muted admin-table__empty">{t("No ready-to-print products yet. Review a project order and create one from it.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
