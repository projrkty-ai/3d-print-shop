import { t } from '../i18n';
import { useId } from 'react';
import type { PrintSettings } from '../types';
import { formatMm } from '../utils/format';
import {
  layerHeightRange, layersForNozzle, nearestColor, partSelection, printSetup, type ModelOptions, type ModelPart, type PartChoice,
} from '../utils/printOptions';

interface EditorProps {
  fileName: string;
  parts: ModelPart[];
  /** Resolved options (valid for `settings`). */
  options: ModelOptions;
  settings: PrintSettings;
  onChange: (options: ModelOptions) => void;
}

/**
 * Nozzle and layer height for the model — only layer heights the nozzle can print are offered —
 * and a filament type and color for each of its color parts. No rates or weights: customers see prices.
 */
export function PrintOptionsEditor({ fileName, parts, options, settings, onChange }: EditorProps) {
  const nozzleId = useId();
  const layerId = useId();
  const setPart = (key: string, choice: PartChoice) => onChange({ ...options, parts: { ...options.parts, [key]: choice } });
  const { nozzle } = printSetup(settings, options);
  const range = layerHeightRange(nozzle.diameterMm);
  return (
    <div className="print-options">
      <div className="print-options__setup">
        <div className="print-options__select">
          <label htmlFor={nozzleId}>{t("Nozzle")}</label>
          <select
            id={nozzleId}
            value={options.nozzleId}
            aria-label={t("Nozzle diameter for {value0}", { value0: fileName })}
            // The layer height stays when the new nozzle can print it; otherwise resolving picks the closest one it can.
            onChange={(e) => onChange({ ...options, nozzleId: e.target.value })}
          >
            {[...settings.nozzles].sort((a, b) => a.diameterMm - b.diameterMm).map((n) => (
              <option key={n.id} value={n.id}>{formatMm(n.diameterMm)}</option>
            ))}
          </select>
        </div>
        <div className="print-options__select">
          <label htmlFor={layerId}>{t("Layer height")}</label>
          <select
            id={layerId}
            value={options.layerHeightId}
            aria-label={t("Layer height for {value0}", { value0: fileName })}
            onChange={(e) => onChange({ ...options, layerHeightId: e.target.value })}
          >
            {layersForNozzle(settings, nozzle).map((layer) => (
              <option key={layer.id} value={layer.id}>{formatMm(layer.heightMm, 2)}</option>
            ))}
          </select>
        </div>
        <small className="muted print-options__hint">
          {t("A {value0} nozzle prints layers from {value1} to {value2}. Thinner layers and smaller nozzles give finer detail but take longer.", {
            value0: formatMm(nozzle.diameterMm), value1: formatMm(range.min, 2), value2: formatMm(range.max, 2),
          })}
        </small>
      </div>
      {parts.length > 1 && <p className="print-options__parts-intro muted">{t("This model has several colors: choose a filament for each.")}</p>}
      {parts.map((part) => (
        <PartFilamentPicker
          key={part.key}
          fileName={fileName}
          part={part}
          single={parts.length === 1}
          choice={options.parts[part.key]}
          settings={settings}
          onChange={(choice) => setPart(part.key, choice)}
        />
      ))}
    </div>
  );
}

interface PickerProps {
  fileName: string;
  part: ModelPart;
  single: boolean;
  choice: PartChoice;
  settings: PrintSettings;
  onChange: (choice: PartChoice) => void;
}

function PartFilamentPicker({ fileName, part, single, choice, settings, onChange }: PickerProps) {
  const groupName = useId();
  const { filament, color } = partSelection(settings, choice);
  const subject = single ? fileName : `${fileName}, ${part.name}`;

  /** A new filament keeps the color when it's offered in it too, otherwise takes the most similar one. */
  const chooseFilament = (filamentId: string) => {
    const next = settings.filaments.find((f) => f.id === filamentId) ?? filament;
    const same = next.colors.find((c) => c.id === color.id) ?? nearestColor(color.hex, next.colors);
    onChange({ filamentId: next.id, colorId: same.id });
  };

  return (
    <fieldset className="filament-picker">
      <legend>
        {single ? t("Filament") : (
          <>
            {part.fileColor && <span className="filament-picker__file-color" style={{ background: part.fileColor }} aria-hidden="true" />}
            {part.name}
          </>
        )}
        <span className="option-group__current">: {filament.name}, {color.name}</span>
      </legend>
      <div className="filament-picker__row">
        <select
          value={filament.id}
          aria-label={t("Filament type for {value0}", { value0: subject })}
          onChange={(e) => chooseFilament(e.target.value)}
        >
          {settings.filaments.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="swatches swatches--small" role="radiogroup" aria-label={t("Color for {value0}", { value0: subject })}>
          {filament.colors.map((c) => (
            <label key={c.id} className={`swatch ${c.id === color.id ? 'is-selected' : ''}`} title={c.name}>
              <input
                type="radio"
                name={groupName}
                value={c.id}
                checked={c.id === color.id}
                onChange={() => onChange({ filamentId: filament.id, colorId: c.id })}
                aria-label={c.name}
              />
              <span className="swatch__dot" style={{ background: c.hex }} />
            </label>
          ))}
        </div>
      </div>
      {filament.description && <small className="muted">{filament.description}</small>}
    </fieldset>
  );
}

/** Read-only list of the chosen nozzle, layer height and filaments (summary step, preview). */
export function PrintOptionsSummary({ parts, options, settings }: Omit<EditorProps, 'fileName' | 'onChange'>) {
  const { nozzle, layerHeight } = printSetup(settings, options);
  return (
    <span className="print-choices">
      <span>{t("Nozzle {value0} · layers {value1}", { value0: formatMm(nozzle.diameterMm), value1: formatMm(layerHeight.heightMm, 2) })}</span>
      {parts.map((part) => {
        const { filament, color } = partSelection(settings, options.parts[part.key]);
        return (
          <span key={part.key} className="print-choices__part">
            <span className="cart-item__dot" style={{ background: color.hex }} aria-hidden="true" />
            {parts.length > 1 && `${part.name}: `}{filament.name}, {color.name}
          </span>
        );
      })}
    </span>
  );
}
