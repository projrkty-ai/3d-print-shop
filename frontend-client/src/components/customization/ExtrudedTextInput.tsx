import { t } from '../../i18n';
import { EXTRUDED_TEXT_MAX_LINES } from '../../config';
import type { ExtrudedTextLayout, SurfaceCustomization } from '../../types';
import { extrudedSizeBounds } from '../../utils/customization';

interface Props {
  layout: ExtrudedTextLayout;
  /** Customer override; undefined keeps the shop's suggestion. */
  text?: string;
  sizeMm?: number;
  error: string | null;
  onChange: (patch: Pick<SurfaceCustomization, 'extrudedText' | 'extrudedSizeMm'>) => void;
}

/** Raised 3D lettering the shop placed on the model: the customer edits the text and its size. */
export function ExtrudedTextInput({ layout, text, sizeMm, error, onChange }: Props) {
  const effectiveText = text ?? layout.defaultText;
  const effectiveSize = sizeMm ?? layout.sizeMm;
  const bounds = extrudedSizeBounds(layout);
  return (
    <fieldset className="option-group">
      <legend>{t("3D lettering")}</legend>
      <p className="option-group__desc">
        {t("Raised 3D text printed onto the model at the spot the shop chose. Change the suggested text, or clear it to print without lettering.")}
      </p>
      <textarea
        rows={Math.min(2, EXTRUDED_TEXT_MAX_LINES)}
        value={effectiveText}
        maxLength={200}
        aria-label={t("3D lettering text")}
        onChange={(event) => onChange({ extrudedText: event.target.value })}
      />
      {error && <p className="field__help is-error" role="alert">{error}</p>}
      <label className="field">
        <span>{t("Lettering size")}: {effectiveSize} mm</span>
        <input
          type="range"
          min={bounds.min}
          max={bounds.max}
          step={0.5}
          value={effectiveSize}
          aria-label={t("3D lettering size in millimeters")}
          onChange={(event) => onChange({ extrudedSizeMm: event.target.valueAsNumber })}
        />
      </label>
      {(text !== undefined || sizeMm !== undefined) && (
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => onChange({ extrudedText: undefined, extrudedSizeMm: undefined })}
        >
          {t("Reset to the suggested lettering")}
        </button>
      )}
    </fieldset>
  );
}
