import { t } from '../i18n';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DimensionsInput } from '../components/customization/DimensionsInput';
import { SurfaceOptions } from '../components/customization/SurfaceOptions';
import { LazyProductPreview as ProductPreview } from '../components/LazyProductPreview';
import { MAX_QUANTITY } from '../config';
import { useCart } from '../store/CartContext';
import { useProducts } from '../store/ProductsContext';
import { useProductDraft } from '../store/useProductDraft';
import type { Customization, Product, SurfaceCustomization } from '../types';
import { customizationSurfaces, normalizeCustomization, normalizeCustomizationText } from '../utils/customization';
import { summarizeConfiguration } from '../utils/orderLines';
import { calculatePrice, engravingColor, formatPrice, sizePrice } from '../utils/pricing';
import { formatDimensions, nearestPrintable, previewScale, roundMm, validateDimensions } from '../utils/sizing';
import { customizationEngravingErrors } from '../utils/validation';
import { LoadState } from '../components/LoadState';
import { NotFoundPage } from './NotFoundPage';
import { includedProductPlates } from '../utils/meshPlates';
import { decorationLayoutFor } from '../utils/decorationLayout';
import { ProductDescription } from '../components/ProductDescription';

export function ProductPage() {
  const { productId } = useParams();
  const { getProduct, load, reload } = useProducts();
  const product = productId ? getProduct(productId) : undefined;

  if (load.status !== 'ready') return <LoadState load={load} onRetry={() => void reload()} loadingText={t("Loading product…")} />;
  if (!product || !product.published) {
    return <NotFoundPage message={t("This product doesn't exist or is no longer available.")} />;
  }
  // Each product initializes from its own saved browser draft.
  return <ProductConfigurator key={product.id} product={product} />;
}

function ProductConfigurator({ product }: { product: Product }) {
  const { addItem } = useCart();
  const { draft, setDraft, quantity, setQuantity, persistenceError } = useProductDraft(product);
  const [added, setAdded] = useState(false);

  if (product.colors.length === 0) {
    return <NotFoundPage message={t("This product is not configured for sale yet.")} />;
  }

  const customization = normalizeCustomization(product, draft);
  const color = product.colors.find((c) => c.id === customization.colorId)!;
  const textColor = engravingColor(product, customization);
  // Multi-color model files: each part shows its chosen filament, or its color from the file.
  const parts = product.mesh?.parts ?? [];
  const includedPlates = includedProductPlates(product);
  const surfaces = customizationSurfaces(product, customization);
  const partChoices = parts.map((part) => {
    const filament = product.colors.find((c) => c.id === customization.partColors[part.key]);
    return { part, colorName: filament?.name ?? t("Original"), colorHex: filament?.hex ?? part.fileColor };
  });
  const dimensionError = validateDimensions(customization.dimensions);
  const engravingErrors = customizationEngravingErrors(product, customization);
  // No price while the size is invalid (e.g. a field is empty or over the build volume).
  const breakdown = dimensionError ? null : calculatePrice(product, customization);
  // Keep the preview steady while the customer is mid-way through typing a size.
  const shownDimensions = nearestPrintable(product.model, customization.dimensions);
  const scale = previewScale(product.model, shownDimensions);

  const update = (patch: Partial<Customization>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setAdded(false);
  };

  function updatePlate(id: number, patch: Partial<SurfaceCustomization>) {
    setDraft((previous) => {
      const current = normalizeCustomization(product, previous);
      return { ...previous, plates: { ...current.plates, [id]: { ...(current.plates?.[id] ?? current), ...patch } } };
    });
    setAdded(false);
  }

  function handleAddToCart() {
    if (!breakdown || engravingErrors.length > 0) return;
    addItem({
      productId: product.id,
      productName: product.name,
      customization: normalizeCustomizationText(customization),
      ...summarizeConfiguration(product, customization),
      unitPrice: breakdown.unitPrice,
      quantity,
    });
    setAdded(true);
  }

  return (
    <div className="product product--description">
      {persistenceError && <p className="banner banner--warning product__banner" role="alert">{persistenceError}</p>}

      <section className="product__information" aria-label={t("Product description")}>
        <nav className="breadcrumbs">
          <Link to="/">{t("Shop")}</Link> / <span>{product.category}</span>
        </nav>
        <h1>{product.name}</h1>
        <ProductDescription product={product} />
        <ul className="product__facts">
          <li><strong>{t("Material:")}</strong> {product.material}</li>
          <li><strong>{t("Ships in:")}</strong> {t('{count} business days', { count: product.productionDays })}</li>
        </ul>
      </section>

      <div className="product__details" aria-label={t("Order configuration")}>
        <p className="product__price">{breakdown ? formatPrice(breakdown.unitPrice) : '—'}</p>
        <div className="product__media product__media--plates">
        {includedPlates.length === 0 ? <ProductPreview
          shape={product.shape}
          meshUrl={product.mesh?.url}
          meshPlate={product.mesh?.plate}
          meshPlates={product.mesh?.selectedPlates}
          partColors={Object.fromEntries(partChoices.map(({ part, colorHex }) => [part.key, colorHex]))}
          color={color.hex}
          engravingColor={textColor?.hex ?? null}
          scale={scale}
          caption={formatDimensions(shownDimensions)}
          engravingText={customization.engravingText}
          engravingFont={customization.engravingFont}
          textureDataUrl={customization.textureDataUrl}
          decorationLayout={decorationLayoutFor(product)}
        /> : surfaces.map(({ plate, choices, parts: localParts }) => {
          if (!plate) return null;
          const plateColor = product.colors.find((option) => option.id === choices.colorId)!;
          const caption = plate.model ? formatDimensions({
            widthMm: roundMm(plate.model.widthMm * scale[0]),
            depthMm: roundMm(plate.model.depthMm * scale[2]),
            heightMm: roundMm(plate.model.heightMm * scale[1]),
          }) : undefined;
          return (
            <section key={plate.id} className="plate-configurator card" aria-label={t("Configure plate: {value0}", { value0: plate.name })}>
              <h2>{plate.name}</h2>
              <p className="muted">{t('{count} objects', { count: plate.objectCount })} {t("· Included in the set")}</p>
              <ProductPreview
                shape={product.shape}
                meshUrl={product.mesh?.url}
                meshPlate={plate.id}
                partColors={Object.fromEntries(localParts.map((part) => [
                  part.key, product.colors.find((color) => color.id === choices.partColors[part.key])?.hex ?? part.fileColor,
                ]))}
                color={plateColor.hex}
                engravingColor={engravingColor(product, choices)?.hex ?? null}
                scale={scale}
                caption={caption}
                engravingText={choices.engravingText}
                engravingFont={choices.engravingFont}
                textureDataUrl={choices.textureDataUrl}
                decorationLayout={decorationLayoutFor(product, plate)}
              />
              <SurfaceOptions
                product={product}
                parts={localParts}
                value={choices}
                error={engravingErrors.find((error) => error.plateId === plate.id)?.message ?? null}
                onChange={(patch) => updatePlate(plate.id, patch)}
                perSet
              />
            </section>
          );
        })}
        </div>

        <section className="configurator" aria-label={t("Personalize your print")}>
          <h2>{t("Personalize")}</h2>
          {includedPlates.length > 0 && (
            <p className="muted">
              {t('Scale applies to all {value0} included plates together.', { value0: includedPlates.length })}{' '}
              {t("Size is the maximum extent on each axis across the set. Configure colors, text and texture in each plate's panel. Engraving, colored engraving and picture texture surcharges are each charged once per set, not per plate.")}
            </p>
          )}
          <DimensionsInput
            model={product.model}
            value={customization.dimensions}
            error={dimensionError}
            onChange={(dimensions) => update({ dimensions })}
            priceLabel={(dims) => formatPrice(sizePrice(product, dims).amount)}
          />
          {includedPlates.length === 0 && (
            <SurfaceOptions
              product={product}
              parts={parts}
              value={customization}
              error={engravingErrors[0]?.message ?? null}
              onChange={update}
            />
          )}
        </section>

        <section className="summary" aria-label={t("Price summary")}>
          {breakdown ? (
            <table className="summary__lines">
              <tbody>
                {breakdown.lines.map((line) => (
                  <tr key={line.label}>
                    <td>
                      {line.label}
                      {line.note && <small className="summary__note">{line.note}</small>}
                    </td>
                    <td>{formatPrice(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{t("Total")}{quantity > 1 && ` (${quantity} × ${formatPrice(breakdown.unitPrice)})`}</td>
                  <td>{formatPrice(breakdown.unitPrice * quantity)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <p className="summary__invalid">{t("Enter a valid print size to see the price.")}</p>
          )}

          <div className="summary__actions">
            <label className="quantity">
              <span>{t("Qty")}</span>
              <input
                type="number"
                min={1}
                max={MAX_QUANTITY}
                value={quantity}
                onChange={(e) => {
                  const q = e.target.valueAsNumber;
                  setQuantity(Number.isFinite(q) ? Math.min(MAX_QUANTITY, Math.max(1, Math.round(q))) : 1);
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn--primary btn--large"
              onClick={handleAddToCart}
              disabled={!breakdown || engravingErrors.length > 0}
            >
              {t("Add to cart")}
            </button>
          </div>
          {added && (
            <p className="banner banner--success" role="status">
              {t("Added to your cart.")} <Link to="/cart">{t("View cart →")}</Link>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
