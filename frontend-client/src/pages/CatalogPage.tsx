import { t } from '../i18n';
import { Link } from 'react-router';
import { LoadState } from '../components/LoadState';
import { ProductThumbnail } from '../components/ProductThumbnail';
import { useProducts } from '../store/ProductsContext';
import { formatPrice, startingPrice } from '../utils/pricing';

export function CatalogPage() {
  const { products, load, reload } = useProducts();
  const visible = products.filter((p) => p.published);

  return (
    <div>
      <section className="hero">
        <h1>{t("Made-to-order 3D prints")}</h1>
        <p>{t("Pick a design, choose its size and color, add your own engraving or picture texture — we print it just for you.")}</p>
      </section>

      {load.status !== 'ready' ? (
        <LoadState load={load} onRetry={() => void reload()} loadingText={t("Loading products…")} />
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <p>{t("No products are available right now.")}</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {visible.map((product) => (
            <Link key={product.id} to={`/product/${product.id}`} className="product-card">
              <div className="product-card__media">
                <ProductThumbnail product={product} />
              </div>
              <div className="product-card__body">
                <span className="product-card__category">{product.category}</span>
                <h2>{product.name}</h2>
                <div className="product-card__colors">
                  {product.colors.slice(0, 6).map((c) => (
                    <span key={c.id} style={{ background: c.hex }} title={c.name} />
                  ))}
                </div>
                <div className="product-card__footer">
                  <span>{t("from")} {formatPrice(startingPrice(product))}</span>
                  <span className="product-card__tags">
                    {product.engraving.enabled && <em>{t("Engravable")}</em>}
                    {product.texture.enabled && <em>{t("Texture")}</em>}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
