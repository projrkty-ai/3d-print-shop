import { t } from '../../i18n';
import type { ColorOption } from '../../types';
import { formatDelta } from '../../utils/pricing';

interface Props {
  colors: ColorOption[];
  /** Selected color id; null selects the `original` swatch. */
  value: string | null;
  onChange: (colorId: string | null) => void;
  legend?: string;
  /** Radio group name; must be unique when several selectors are on one page. */
  name?: string;
  /**
   * A first choice selected when `value` is null — e.g. the color from the model file.
   * Without `hex` the swatch is drawn empty (no single color to show).
   */
  original?: { hex?: string; label?: string; description?: string };
}

export function ColorSelector({ colors, value, onChange, legend = t("Color"), name = 'color', original }: Props) {
  const selected = colors.find((c) => c.id === value);
  const originalLabel = original?.label ?? t("Original");
  const selectedName = selected?.name ?? (original && value === null ? originalLabel : undefined);
  return (
    <fieldset className="option-group">
      <legend>
        {legend}
        {selectedName && <span className="option-group__current">: {selectedName}</span>}
      </legend>
      <div className="swatches">
        {original && (
          <label
            className={`swatch swatch--original ${value === null ? 'is-selected' : ''}`}
            title={original.description ?? t("Original color from the design")}
          >
            <input
              type="radio"
              name={name}
              checked={value === null}
              onChange={() => onChange(null)}
              aria-label={`${legend}: ${original.description ?? t("original color from the design")}`}
            />
            <span
              className={`swatch__dot ${original.hex ? '' : 'swatch__dot--none'}`}
              style={original.hex ? { background: original.hex } : undefined}
            />
            <span className="swatch__delta">{originalLabel}</span>
          </label>
        )}
        {colors.map((color) => (
          <label
            key={color.id}
            className={`swatch ${color.id === value ? 'is-selected' : ''}`}
            title={`${color.name} ${formatDelta(color.priceDelta)}`.trim()}
          >
            <input
              type="radio"
              name={name}
              value={color.id}
              checked={color.id === value}
              onChange={() => onChange(color.id)}
              aria-label={original ? `${legend}: ${color.name}` : color.name}
            />
            <span className="swatch__dot" style={{ background: color.hex }} />
            {color.priceDelta !== 0 && <span className="swatch__delta">{formatDelta(color.priceDelta)}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
