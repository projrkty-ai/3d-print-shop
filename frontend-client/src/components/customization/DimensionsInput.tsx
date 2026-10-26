import { t } from '../../i18n';
import { PRINT_MAX_MM, PRINT_MIN_MM } from '../../config';
import type { Dimensions, ModelSpec } from '../../types';
import {
  AXES,
  AXIS_LABELS,
  currentScale,
  formatDimensions,
  maxUniformScale,
  minUniformScale,
  percentRange,
  resizeProportionally,
  scaleDimensions,
  type Axis,
} from '../../utils/sizing';

interface Props {
  model: ModelSpec;
  value: Dimensions;
  error: string | null;
  onChange: (dims: Dimensions) => void;
  /** Price of the bare print at a given size, shown on the quick-pick buttons. */
  priceLabel: (dims: Dimensions) => string;
}

const PRESET_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const percent = (factor: number) => `${Math.round(factor * 100)}%`;

/** Size picker that always keeps the model's proportions: editing one side rescales the others. */
export function DimensionsInput({ model, value, error, onChange, priceLabel }: Props) {
  const minScale = minUniformScale(model);
  const maxScale = maxUniformScale(model);
  const presets = [
    ...PRESET_SCALES.filter((f) => f >= minScale && f <= maxScale && Math.abs(f - maxScale) > 0.02),
    maxScale,
  ];
  const scale = currentScale(model, value);
  const range = percentRange(model);
  // The thumb can't go past the printable range, even if a typed size does (that shows an error).
  const sliderPercent = Math.min(range.max, Math.max(range.min, Math.round((scale ?? 1) * 100)));

  function handleAxis(axis: Axis, typed: number) {
    if (Number.isFinite(typed) && typed > 0) {
      onChange(resizeProportionally(model, axis, typed));
    } else {
      // Field cleared mid-edit: leave the other sides alone until a number is entered.
      onChange({ ...value, [axis]: typed });
    }
  }

  return (
    <fieldset className="option-group">
      <legend>
        {t("Size")}
        {scale !== null && <span className="option-group__current">: {percent(scale)} {t("of original")}</span>}
      </legend>

      <div className="size-presets" role="group" aria-label={t("Quick sizes")}>
        {presets.map((factor) => {
          const dims = scaleDimensions(model, factor);
          const isMax = factor === maxScale;
          const active = scale !== null && Math.abs(scale - factor) < 0.005;
          return (
            <button
              key={factor}
              type="button"
              className={`size-preset ${active ? 'is-selected' : ''}`}
              onClick={() => onChange(dims)}
            >
              <span className="size-preset__label">
                {isMax ? t("Max") : factor === 1 ? t("Original") : percent(factor)}
              </span>
              <span className="size-preset__price">{priceLabel(dims)}</span>
            </button>
          );
        })}
      </div>

      <div className="scale-slider">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={1}
          value={sliderPercent}
          onChange={(e) => onChange(scaleDimensions(model, e.target.valueAsNumber / 100))}
          aria-label={t("Size as a percentage of the original")}
          aria-valuetext={`${sliderPercent}%, ${formatDimensions(scaleDimensions(model, sliderPercent / 100))}`}
        />
        <output className="scale-slider__value" aria-hidden="true">
          {scale !== null ? percent(scale) : '—'}
        </output>
      </div>
      <div className="scale-slider__bounds" aria-hidden="true">
        <span>{range.min}%</span>
        <span>{range.max}%</span>
      </div>

      <div className="dimensions">
        {AXES.map((axis, i) => (
          <div key={axis} className="dimensions__axis">
            {i > 0 && <span className="dimensions__times" aria-hidden="true">×</span>}
            <label className="field dimensions__field">
              <span>{AXIS_LABELS[axis]}</span>
              <span className="input-suffix">
                <input
                  type="number"
                  inputMode="decimal"
                  min={PRINT_MIN_MM}
                  max={PRINT_MAX_MM}
                  step={1}
                  value={Number.isNaN(value[axis]) ? '' : value[axis]}
                  onChange={(e) => handleAxis(axis, e.target.valueAsNumber)}
                  aria-invalid={error !== null}
                  aria-describedby="dimensions-help"
                />
                <span>mm</span>
              </span>
            </label>
          </div>
        ))}
      </div>

      <p id="dimensions-help" className={`field__help dimensions__help ${error ? 'is-error' : ''}`}>
        {error ??
          t("Proportions match the original model — change any side and the others follow. Each side {value0}–{value1} mm (printer build volume {value2} × {value3} × {value4} mm).", { value0: PRINT_MIN_MM, value1: PRINT_MAX_MM, value2: PRINT_MAX_MM, value3: PRINT_MAX_MM, value4: PRINT_MAX_MM })}
      </p>
    </fieldset>
  );
}
