import { t } from '../../i18n';
import { LOCALE } from '../../config';
import type { MeshPlate, Product, SurfaceCustomization } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { chosenVariant, offeredVariants, surfaceSlicing, usesVariantPricing, variantPriceAt } from '../../utils/printVariants';

interface Props {
  product: Product;
  /** The plate the variant prints, or null for a model without plates. */
  plate: Pick<MeshPlate, 'id'> | null;
  value: Pick<SurfaceCustomization, 'variantId'>;
  /** Uniform scale of the print (1 = original size); null hides the prices while the size is invalid. */
  scale: number | null;
  onChange: (variantId: string) => void;
  /** Radio group name; must be unique when several selectors are on one page. */
  name: string;
}

const mm = (value: number) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(value);
const roundCents = (value: number) => Math.round(value * 100) / 100;

/** How the plate is printed (nozzle, layer height, material), as sliced and priced by the shop. */
export function VariantSelector({ product, plate, value, scale, onChange, name }: Props) {
  if (!usesVariantPricing(product)) return null;
  const variants = offeredVariants(surfaceSlicing(product, plate));
  const selected = chosenVariant(product, plate, value);
  if (variants.length === 0 || !selected) return null;
  return (
    <fieldset className="option-group">
      <legend>
        {t("Print quality")}
        {variants.length > 1 && <span className="option-group__current">: {selected.label}</span>}
      </legend>
      <div className="variant-options">
        {variants.map((variant) => {
          const price = scale === null ? null : variantPriceAt(product, plate?.id ?? null, variant, scale);
          return (
            <label key={variant.id} className={`variant-option ${variant.id === selected.id ? 'is-selected' : ''}`}>
              <input type="radio" name={name} value={variant.id} checked={variant.id === selected.id} onChange={() => onChange(variant.id)} />
              <span className="variant-option__label">{variant.label}</span>
              <span className="variant-option__facts">
                {t("{0} mm nozzle · {1} mm layers · {2}", mm(variant.nozzleMm), mm(variant.layerHeightMm), variant.material)}
              </span>
              {price !== null && Number.isFinite(price) && (
                <span className="variant-option__price">{formatPrice(roundCents(price))}</span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
