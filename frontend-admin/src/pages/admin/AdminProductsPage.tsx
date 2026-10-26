import { formatCount, t } from '../../i18n';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError, toProductBody } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { ProductThumbnail } from '../../components/ProductThumbnail';
import { useProducts } from '../../store/ProductsContext';
import type { Product } from '../../types';
import { formatPrice, formatRate, pricePerCm3 } from '../../utils/pricing';
import { formatDimensions, formatVolume } from '../../utils/sizing';

export function AdminProductsPage() {
  const { products, load, reload, createProduct, updateProduct, deleteProduct } = useProducts();
  const navigate = useNavigate();
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = products.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
  );

  /** Runs an API action for one product row, showing failures in a banner. */
  async function run(product: Product, action: () => Promise<unknown>) {
    setError(null);
    setBusyId(product.id);
    try {
      await action();
    } catch (err) {
      setError(`${product.name}: ${err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Something went wrong.")}`);
    } finally {
      setBusyId(null);
    }
  }

  const togglePublished = (product: Product, published: boolean) =>
    run(product, () => updateProduct(product.id, toProductBody({ ...product, published })));

  const duplicate = (product: Product) =>
    run(product, async () => {
      // The copy shares the model file; the server keeps it until no product uses it.
      const copy = await createProduct(toProductBody({ ...product, name: `${product.name} (copy)`, published: false }));
      navigate(`/admin/products/${copy.id}`);
    });

  const remove = (product: Product) => {
    if (window.confirm(t("Delete \"{0}\"? This cannot be undone.", product.name))) void run(product, () => deleteProduct(product.id));
  };

  if (load.status !== 'ready') return <LoadState load={load} onRetry={() => void reload()} loadingText={t("Loading products…")} />;

  return (
    <div className="admin">
      <div className="admin__header">
        <div>
          <h1>{t("Products")}</h1>
          <p className="muted">
            {formatCount('product', products.length)} ·{' '}
            {products.filter((p) => p.published).length} {t("published")}</p>
        </div>
        <div className="admin__header-actions">
          <Link to="/admin/products/new" className="btn btn--primary">{t("+ New product")}</Link>
        </div>
      </div>

      {flash && !error && (
        <p className="banner banner--success" role="status">
          {flash}
        </p>
      )}
      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}

      <input
        type="search"
        className="admin__search"
        placeholder={t("Search by name or category…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Product")}</th>
              <th>{t("Price (original size)")}</th>
              <th>{t("Options")}</th>
              <th>{t("Published")}</th>
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="admin-table__product">
                    <Link to={`/admin/products/${product.id}`} className="admin-table__thumbnail" aria-label={t("Edit {0}", product.name)}>
                      <ProductThumbnail product={product} />
                    </Link>
                    <div>
                      <Link to={`/admin/products/${product.id}`} className="admin-table__name">
                        {product.name}
                      </Link>
                      <div className="muted">{product.category}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {formatPrice(product.basePrice)}
                  <div className="muted">{t("fee")} {formatPrice(product.fixedFee)} + {formatRate(pricePerCm3(product))}
                  </div>
                </td>
                <td>
                  <div className="admin-table__options">
                    <span>
                      {formatDimensions(product.model)} · {formatVolume(product.model.volumeCm3)}
                    </span>
                    <span className="admin-table__colors">
                      {product.colors.map((c) => (
                        <i key={c.id} style={{ background: c.hex }} title={c.name} />
                      ))}
                    </span>
                    {product.engraving.enabled && <em>{t("Engraving")}</em>}
                    {product.texture.enabled && <em>{t("Texture")}</em>}
                  </div>
                </td>
                <td>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={product.published}
                      onChange={(e) => void togglePublished(product, e.target.checked)}
                      disabled={busyId === product.id}
                      aria-label={t("Published: {0}", product.name)}
                    />
                    <span />
                  </label>
                </td>
                <td>
                  <div className="admin-table__actions">
                    <Link to={`/admin/products/${product.id}`} className="btn btn--small">{t("Edit")}</Link>
                    <Link to={`/product/${product.id}`} className="btn btn--small btn--ghost">{t("View")}</Link>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => void duplicate(product)}
                      disabled={busyId === product.id}
                    >{t("Duplicate")}</button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--danger"
                      onClick={() => remove(product)}
                      disabled={busyId === product.id}
                    >{t("Delete")}</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="muted admin-table__empty">{t("No products match “")}{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
