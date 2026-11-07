import { useId } from 'react';
import { MAX_QUANTITY } from '../config';
import { t } from '../i18n';
import { MAX_FILAMENTS, PROJECT_MATERIALS, type ProjectMaterial, type ProjectPrintSettings } from '../types';
import { COLOR_MAX_LENGTH, defaultFilament, SCALE_PERCENT } from '../utils/projectOrderDraft';

export const MATERIAL_LABELS: Record<ProjectMaterial, () => string> = {
  any: () => t('No preference'), PLA: () => 'PLA', PETG: () => 'PETG', ABS: () => 'ABS', ASA: () => 'ASA', TPU: () => t('TPU (flexible)'),
  resin: () => t('Resin'),
};

/** Suggestions only: customers may type any color. */
export const COLOR_SUGGESTIONS = () => [
  t('Black'), t('White'), t('Gray'), t('Silver'), t('Red'), t('Orange'), t('Yellow'), t('Green'), t('Blue'), t('Purple'), t('Pink'),
  t('Brown'), t('Beige'), t('Gold'), t('Transparent'), t('Glow in the dark'),
];

interface Props {
  settings: ProjectPrintSettings;
  onChange: (settings: ProjectPrintSettings) => void;
  /** What the settings apply to, used in accessible names ("hook.stl", "all selected models"). */
  subject: string;
}

/** Quantity, scale and one or more material + color pairs (multi-color / multi-material prints) for one model. */
export function PrintSettingsEditor({ settings, onChange, subject }: Props) {
  const colorList = useId();
  const set = <K extends keyof ProjectPrintSettings>(key: K, value: ProjectPrintSettings[K]) => onChange({ ...settings, [key]: value });
  const setFilament = (index: number, patch: Partial<ProjectPrintSettings['filaments'][number]>) =>
    set('filaments', settings.filaments.map((filament, i) => (i === index ? { ...filament, ...patch } : filament)));
  const multi = settings.filaments.length > 1;

  return (
    <div className="print-settings">
      <div className="print-settings__row">
        <label className="field">
          <span>{t('Quantity')}</span>
          <input type="number" min={1} max={MAX_QUANTITY} required value={settings.quantity}
            aria-label={t('Quantity for {subject}', { subject })}
            onChange={(e) => set('quantity', Math.min(MAX_QUANTITY, Math.max(1, Math.round(Number(e.target.value)) || 1)))} />
        </label>
        <label className="field">
          <span>{t('Scale (%)')}</span>
          <input type="number" min={SCALE_PERCENT.min} max={SCALE_PERCENT.max} required value={settings.scalePercent}
            aria-label={t('Scale in percent for {subject}', { subject })}
            onChange={(e) => set('scalePercent', Math.min(SCALE_PERCENT.max, Math.max(SCALE_PERCENT.min, Math.round(Number(e.target.value)) || 100)))} />
        </label>
      </div>

      <fieldset className="print-settings__filaments">
        <legend>{t('Materials and colors')}</legend>
        <datalist id={colorList}>
          {COLOR_SUGGESTIONS().map((color) => <option key={color} value={color} />)}
        </datalist>
        <ol>
          {settings.filaments.map((filament, index) => {
            const name = multi ? t('{subject}, color {number}', { subject, number: index + 1 }) : subject;
            return (
              <li key={index} className="print-settings__filament">
                {multi && <span className="print-settings__index" aria-hidden="true">{index + 1}</span>}
                <select value={filament.material} aria-label={t('Material for {name}', { name })}
                  onChange={(e) => setFilament(index, { material: e.target.value as ProjectMaterial })}>
                  {PROJECT_MATERIALS.map((material) => <option key={material} value={material}>{MATERIAL_LABELS[material]()}</option>)}
                </select>
                <input list={colorList} value={filament.color} maxLength={COLOR_MAX_LENGTH} placeholder={t('Any color')}
                  aria-label={t('Color for {name}', { name })} onChange={(e) => setFilament(index, { color: e.target.value })} />
                {multi && (
                  <button type="button" className="icon-btn" aria-label={t('Remove {name}', { name })}
                    onClick={() => set('filaments', settings.filaments.filter((_, i) => i !== index))}>×</button>
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn--small btn--ghost" disabled={settings.filaments.length >= MAX_FILAMENTS}
          onClick={() => set('filaments', [...settings.filaments, defaultFilament()])}>
          {t('+ Add material or color')}
        </button>
        {multi && <p className="muted print-settings__hint">{t('For multi-color or multi-material prints, list each part’s material and color.')}</p>}
      </fieldset>
    </div>
  );
}
