import { t } from '../../i18n';
import { PRINT_MAX_MM, PRINT_MIN_MM } from '../../config';
import type { ModelSpec, Product, ProductScaling } from '../../types';
import { formatPrice, sizePrice } from '../../utils/pricing';
import { offeredVariants, usesVariantPricing } from '../../utils/printVariants';
import { formatScale, slicedScales } from '../../utils/scaling';
import { AXES, AXIS_LABELS, formatDimensions, formatVolume, maxUniformScale, minUniformScale, scaleDimensions } from '../../utils/sizing';
import { Field, NumberInput } from './formFields';

/** Scale range offered when the admin turns scaling on: 50%–150%, within what the printer can do. */
export function defaultScaling(model: ModelSpec, enabled: boolean): ProductScaling {
  const valid = modelSizeValid(model);
  return {
    enabled,
    minScale: valid ? Math.max(0.5, Math.ceil(minUniformScale(model) * 100 - 1e-9) / 100) : 0.5,
    maxScale: valid ? Math.min(1.5, Math.floor(maxUniformScale(model) * 100 + 1e-9) / 100) : 1.5,
  };
}

/** True when the original size and volume are printable, so sizes and prices can be shown. */
export function modelSizeValid(model: ModelSpec): boolean {
  return AXES.every((axis) => Number.isFinite(model[axis]) && model[axis] >= PRINT_MIN_MM && model[axis] <= PRINT_MAX_MM)
    && Number.isFinite(model.volumeCm3) && model.volumeCm3 > 0;
}

/** Keeps the scale range printable after the model's size changed (e.g. another file or plates). */
export function fitScaling(scaling: ProductScaling | undefined, model: ModelSpec): ProductScaling | undefined {
  if (!scaling || !modelSizeValid(model)) return scaling;
  const min = Math.ceil(minUniformScale(model) * 100 - 1e-9) / 100;
  const max = Math.floor(maxUniformScale(model) * 100 + 1e-9) / 100;
  return {
    ...scaling,
    minScale: Number.isFinite(scaling.minScale) ? Math.min(1, Math.max(min, scaling.minScale)) : scaling.minScale,
    maxScale: Number.isFinite(scaling.maxScale) ? Math.max(1, Math.min(max, scaling.maxScale)) : scaling.maxScale,
  };
}

const percentValue = (scale: number) => (Number.isFinite(scale) ? Math.round(scale * 10000) / 100 : Number.NaN);

interface Props {
  product: Product;
  onScalingChange: (scaling: ProductScaling) => void;
  /** Changes the original size, which products without a model file enter by hand (omitted: a file is required). */
  onModelChange?: (patch: Partial<ModelSpec>) => void;
  /** Price of one print at a scale for the example table (default: the catalog's print price). */
  examplePrice?: (scale: number) => number | null;
}

/**
 * Whether customers may order the product in other sizes, and the smallest and largest scale.
 * Print variants are sliced at both ends of the range, and the example prices show what they give.
 */
export function ScalingEditor({ product, onScalingChange, onModelChange, examplePrice }: Props) {
  const priceAt = examplePrice ?? ((scale: number) => sizePrice(product, scaleDimensions(product.model, scale)).amount);
  const { model } = product;
  const scaling = product.scaling ?? defaultScaling(model, true);
  const sizeValid = modelSizeValid(model);
  const update = (patch: Partial<ProductScaling>) => onScalingChange({ ...scaling, ...patch });
  const variantPricing = usesVariantPricing(product);
  const scalesValid = Number.isFinite(scaling.minScale) && Number.isFinite(scaling.maxScale) && scaling.minScale > 0 && scaling.maxScale > 0;
  const examples = !scaling.enabled ? [{ label: t("Original"), scale: 1 }] : [
    { label: t("Smallest"), scale: scaling.minScale },
    { label: t("Original"), scale: 1 },
    { label: t("Largest"), scale: scaling.maxScale },
  ].filter((example, i, all) => i === 1 || Math.abs(example.scale - 1) > 1e-9 || all.length === 1);
  // Variants sliced before the range changed are priced by extrapolation until they are sliced again.
  const needed = slicedScales(product);
  const unsliced = variantPricing && (product.slicing ?? []).some((entry) => offeredVariants(entry).some((variant) =>
    needed.some((scale) => !(variant.scaled ?? []).some((point) => Math.abs(point.scale - scale) < 1e-6))));

  return (
    <section className="card scaling">
      <h2>{t("Scaling")}</h2>
      <p className="muted card__intro">
        {t("Choose whether customers can order this model in other sizes. Print variants are sliced at the original size and at the smallest and largest scale; prices of sizes in between are interpolated from them.")}
      </p>

      {!product.mesh && !onModelChange ? (
        <p className="muted">{t("Load a print file to offer other sizes.")}</p>
      ) : product.mesh ? (
        <p className="scaling__original">
          <strong>{t("Original size:")}</strong> {sizeValid ? `${formatDimensions(model)} · ${formatVolume(model.volumeCm3)}` : '—'}{' '}
          <span className="muted">{t("(from the model file)")}</span>
        </p>
      ) : (
        <>
          <p className="muted">{t("Without a model file, enter the original size and volume: they size the preview and the volume price estimate.")}</p>
          <div className="form-grid form-grid--4">
            {AXES.map((axis) => (
              <Field key={axis} label={`${AXIS_LABELS[axis]} (mm)`}>
                <NumberInput min={PRINT_MIN_MM} max={PRINT_MAX_MM} step={0.1} value={model[axis]} onChange={(value) => onModelChange?.({ [axis]: value })} />
              </Field>
            ))}
            <Field label={t("Volume (cm³)")}>
              <NumberInput min={0.1} step={0.1} value={model.volumeCm3} onChange={(volumeCm3) => onModelChange?.({ volumeCm3 })} />
            </Field>
          </div>
        </>
      )}

      {(product.mesh || onModelChange) && <label className="checkbox scaling__toggle">
        <input type="checkbox" checked={scaling.enabled}
          onChange={(event) => onScalingChange(event.target.checked
            // Turning scaling back on restores the previous range.
            ? { ...(scaling.minScale < scaling.maxScale ? scaling : defaultScaling(model, true)), enabled: true }
            : { ...scaling, enabled: false })} />
        {t("Customers can choose the print size")}
      </label>}

      {scaling.enabled ? (
        <div className="form-grid">
          <Field label={t("Smallest scale (%)")}
            hint={sizeValid && scalesValid ? formatDimensions(scaleDimensions(model, scaling.minScale)) : undefined}>
            <NumberInput min={1} max={100} step={1} value={percentValue(scaling.minScale)} onChange={(value) => update({ minScale: value / 100 })} />
          </Field>
          <Field label={t("Largest scale (%)")}
            hint={sizeValid && scalesValid ? formatDimensions(scaleDimensions(model, scaling.maxScale)) : undefined}>
            <NumberInput min={100} step={1} value={percentValue(scaling.maxScale)} onChange={(value) => update({ maxScale: value / 100 })} />
          </Field>
        </div>
      ) : (
        <p className="muted">{t("Customers order the original size only.")}</p>
      )}
      {scaling.enabled && sizeValid && (
        <p className="muted">
          {t("The printer can make this model from {0} to {1} of its size ({2}–{3} mm per side).",
            formatScale(Math.ceil(minUniformScale(model) * 100 - 1e-9) / 100), formatScale(Math.floor(maxUniformScale(model) * 100 + 1e-9) / 100),
            PRINT_MIN_MM, PRINT_MAX_MM)}
        </p>
      )}

      {sizeValid && scalesValid ? (
        <div className="table-wrap">
          <table className="option-table price-examples">
            <caption>{variantPricing
              ? t("Prices with the default print variants (before color, engraving and texture)")
              : t("Prices estimated from the model volume (before color, engraving and texture)")}</caption>
            <thead>
              <tr>
                <th>{t("Scale")}</th>
                <th>{t("Size")}</th>
                <th>{t("Print price")}</th>
              </tr>
            </thead>
            <tbody>
              {examples.map(({ label, scale }) => {
                const dims = scaleDimensions(model, scale);
                return (
                  <tr key={label}>
                    <td>{label} <span className="muted">({formatScale(scale)})</span></td>
                    <td>{formatDimensions(dims)}</td>
                    <td>{(() => {
                      const price = priceAt(scale);
                      return price === null || !Number.isFinite(price) ? '—' : formatPrice(price);
                    })()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t("Enter a valid original size and scale range to see example prices.")}</p>
      )}
      {unsliced && (
        <p className="banner banner--warning">{t("Some offered print variants are not sliced at {0} yet: slice them again below.", needed.map(formatScale).join(', '))}</p>
      )}
    </section>
  );
}
