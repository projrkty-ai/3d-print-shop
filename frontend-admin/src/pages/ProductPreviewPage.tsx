import { t } from '../i18n';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { LazyProductPreview } from '../components/LazyProductPreview';
import { LoadState } from '../components/LoadState';
import { DimensionsInput } from '../components/customization/DimensionsInput';
import { SurfaceOptions } from '../components/customization/SurfaceOptions';
import { useProducts } from '../store/ProductsContext';
import type { Customization, Product, SurfaceCustomization } from '../types';
import { customizationSurfaces, defaultCustomization, normalizeCustomization } from '../utils/customization';
import { decorationLayoutFor } from '../utils/decorationLayout';
import { calculatePrice, engravingColor, formatPrice, sizePrice } from '../utils/pricing';
import { formatDimensions, nearestPrintable, previewScale, validateDimensions } from '../utils/sizing';
import { customizationEngravingErrors } from '../utils/validation';
import { NotFoundPage } from './NotFoundPage';
import { ProductDescription } from '../components/ProductDescription';

export function ProductPreviewPage() {
  const { productId } = useParams();
  const { getProduct, load, reload } = useProducts();
  if (load.status !== 'ready') return <LoadState load={load} onRetry={() => void reload()} loadingText={t("Loading product…")} />;
  const product = productId ? getProduct(productId) : undefined;
  if (!product) return <NotFoundPage message={t("This product doesn't exist.")} />;
  return <Preview key={product.id} product={product} />;
}

function Preview({ product }: { product: Product }) {
  const [draft, setDraft] = useState(() => defaultCustomization(product));
  if (product.colors.length === 0) return <NotFoundPage message={t("Add at least one filament color before previewing.")} />;
  const customization = normalizeCustomization(product, draft);
  const dimensions = nearestPrintable(product.model, customization.dimensions);
  const scale = previewScale(product.model, dimensions);
  const dimensionError = validateDimensions(customization.dimensions);
  const errors = customizationEngravingErrors(product, customization);
  const update = (patch: Partial<Customization>) => setDraft((previous) => ({ ...previous, ...patch }));
  function updateSurface(plateId: number | undefined, patch: Partial<SurfaceCustomization>) {
    setDraft((previous) => {
      if (plateId === undefined) return { ...previous, ...patch };
      const current = normalizeCustomization(product, previous);
      return { ...previous, plates: { ...current.plates, [plateId]: { ...(current.plates?.[plateId] ?? current), ...patch } } };
    });
  }
  return (
    <div className="product product--description">
      <p className="banner banner--warning product__banner">{t("Admin preview only. Sample choices are not saved or added to a cart.")}</p>
      <section className="product__information" aria-label={t("Product description")}>
        <Link to={`/admin/products/${product.id}`}>{t("Back to product editor")}</Link>
        <h1>{product.name}</h1>
        <ProductDescription product={product} />
      </section>
      <div className="product__details" aria-label={t("Order configuration preview")}>
        <p className="product__price">{dimensionError ? '—' : formatPrice(calculatePrice(product, customization).unitPrice)}</p>
        <div className="product__media product__media--plates">
        {customizationSurfaces(product, customization).map(({ plate, choices, parts }) => (
          <section key={plate?.id ?? 'root'} className="plate-configurator card" aria-label={t("Preview: {0}", plate?.name ?? product.name)}>
            <h2>{plate?.name ?? product.name}</h2>
            <LazyProductPreview
              shape={product.shape}
              meshUrl={product.mesh?.url}
              meshPlate={plate?.id ?? product.mesh?.plate}
              color={product.colors.find((color) => color.id === choices.colorId)!.hex}
              partColors={Object.fromEntries(parts.map((part) => [
                part.key, product.colors.find((color) => color.id === choices.partColors[part.key])?.hex ?? part.fileColor,
              ]))}
              scale={scale}
              caption={plate ? undefined : formatDimensions(dimensions)}
              engravingText={choices.engravingText}
              engravingFont={choices.engravingFont}
              engravingColor={engravingColor(product, choices)?.hex ?? null}
              textureDataUrl={choices.textureDataUrl}
              decorationLayout={decorationLayoutFor(product, plate)}
            />
            <SurfaceOptions product={product} parts={parts} value={choices}
              error={errors.find((error) => error.plateId === (plate?.id ?? null))?.message ?? null}
              onChange={(patch) => updateSurface(plate?.id, patch)} perSet={plate !== null} />
          </section>
        ))}
        </div>
        <DimensionsInput model={product.model} value={customization.dimensions} error={dimensionError}
          onChange={(dimensions) => update({ dimensions })} priceLabel={(dimensions) => formatPrice(sizePrice(product, dimensions).amount)} />
      </div>
    </div>
  );
}
