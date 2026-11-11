import { t } from '../i18n';
import { useId } from 'react';
import { PRINT_MAX_MM, PRINT_MIN_MM } from '../config';
import type { CustomerSlicingProfile, Dimensions, PrintSettings } from '../types';
import { formatMm } from '../utils/format';
import {
  nearestColor, offeredPresets, partSelection, profileFacts, SCALE_RANGE, type ModelOptions, type ModelPart, type PartChoice,
} from '../utils/printOptions';
import { formatDimensions } from '../utils/sizing';

interface EditorProps {
  fileName: string;
  parts: ModelPart[];
  /** Resolved options (valid for `settings`). */
  options: ModelOptions;
  settings: PrintSettings;
  /** The model's size in the file, to show the scaled size. */
  size: Dimensions;
  onChange: (options: ModelOptions) => void;
}

const scaled = (size: Dimensions, scale: number): Dimensions =>
  ({ widthMm: size.widthMm * scale, depthMm: size.depthMm * scale, heightMm: size.heightMm * scale });

/** Problem with a scaled model the shop can't print as it is, or null. */
export function scaleProblem(size: Dimensions, scale: number): string | null {
  const dims = scaled(size, scale);
  const sides = [dims.widthMm, dims.depthMm, dims.heightMm];
  if (Math.max(...sides) > PRINT_MAX_MM) return t("At this scale the model is larger than our {value0} mm build volume — we'll suggest splitting it.", { value0: PRINT_MAX_MM });
  if (Math.min(...sides) < PRINT_MIN_MM) return t("At this scale a side is thinner than {value0} mm and may not print well.", { value0: PRINT_MIN_MM });
  return null;
}

/**
 * The one slicing profile the model is estimated with — printer, print profile (process) and
 * filament profile from the shop's offer, supports and a scale — and a filament type and color for
 * each color part. No print times, weights or rates: customers see prices.
 */
export function PrintOptionsEditor({ fileName, parts, options, settings, size, onChange }: EditorProps) {
  const ids = { printer: useId(), process: useId(), filament: useId(), scale: useId() };
  const { printers, processesFor, filamentsFor } = offeredPresets(settings);
  const { profile } = options;
  const setProfile = (patch: Partial<CustomerSlicingProfile>) => onChange({ ...options, profile: { ...profile, ...patch } });
  const setPart = (key: string, choice: PartChoice) => onChange({ ...options, parts: { ...options.parts, [key]: choice } });
  const facts = profileFacts(profile);
  const percent = Math.round(profile.scale * 1000) / 10;
  const problem = scaleProblem(size, profile.scale);
  return (
    <div className="print-options">
      <fieldset className="print-options__profile">
        <legend>{t("Slicing profile")}</legend>
        <div className="print-options__setup">
          <div className="print-options__select">
            <label htmlFor={ids.printer}>{t("Printer")}</label>
            <select id={ids.printer} value={profile.printer} aria-label={t("Printer for {value0}", { value0: fileName })}
              // Another printer keeps the process and filament when they suit it; otherwise resolving picks its defaults.
              onChange={(e) => setProfile({ printer: e.target.value })}>
              {printers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="print-options__select">
            <label htmlFor={ids.process}>{t("Print profile")}</label>
            <select id={ids.process} value={profile.process} aria-label={t("Print profile for {value0}", { value0: fileName })}
              onChange={(e) => setProfile({ process: e.target.value })}>
              {processesFor(profile.printer).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="print-options__select">
            <label htmlFor={ids.filament}>{t("Filament profile")}</label>
            <select id={ids.filament} value={profile.filament} aria-label={t("Filament profile for {value0}", { value0: fileName })}
              onChange={(e) => setProfile({ filament: e.target.value })}>
              {filamentsFor(profile.printer).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <label className="checkbox print-options__support">
            <input type="checkbox" checked={profile.support} onChange={(e) => setProfile({ support: e.target.checked })}
              aria-label={t("Supports for {value0}", { value0: fileName })} />
            {t("Supports")}
          </label>
          <div className="print-options__select print-options__scale">
            <label htmlFor={ids.scale}>{t("Scale")}</label>
            <span className="input-suffix">
              <input id={ids.scale} type="number" min={SCALE_RANGE.min * 100} max={SCALE_RANGE.max * 100} step={1} value={percent}
                aria-label={t("Scale of {value0} in percent", { value0: fileName })}
                onChange={(e) => Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber > 0 && setProfile({ scale: e.target.valueAsNumber / 100 })} />
              <span>%</span>
            </span>
          </div>
          <small className="muted print-options__hint">
            {Number.isFinite(facts.nozzleMm) && Number.isFinite(facts.layerHeightMm)
              && t("{value0} nozzle, {value1} layers.", { value0: formatMm(facts.nozzleMm), value1: formatMm(facts.layerHeightMm, 2) })}{' '}
            {t("Printed size: {value0}.", { value0: formatDimensions(scaled(size, profile.scale)) })}
          </small>
          {problem && <small className="print-options__hint model-row__warning">{problem}</small>}
        </div>
      </fieldset>
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

/** Read-only list of the chosen profile, scale and filaments (summary step, preview). */
export function PrintOptionsSummary({ parts, options, settings }: Omit<EditorProps, 'fileName' | 'onChange' | 'size'>) {
  const { profile } = options;
  return (
    <span className="print-choices">
      <span>{profile.printer} · {profile.process} · {profile.filament}</span>
      <span>
        {t("Scale {value0}%", { value0: Math.round(profile.scale * 1000) / 10 })}
        {profile.support && ` · ${t("with supports")}`}
      </span>
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
