import { formatNumber, t } from '../../i18n';
import { useId, useState } from 'react';
import type { DecorationLayout } from '../../types';
import { DEFAULT_TEXT_LAYOUT, DEFAULT_TEXTURE_LAYOUT } from '../../utils/decorationLayout';

interface Props {
  value?: DecorationLayout;
  textEnabled: boolean;
  textureEnabled: boolean;
  onChange: (layout: DecorationLayout | undefined) => void;
}

function PercentControl({ label, value, min = 0, onChange }: {
  label: string; value: number; min?: number; onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}: <output htmlFor={id}>{formatNumber(value)}%</output></span>
      <input id={id} type="range" min={min} max={100} step={1} value={value} onChange={(event) => onChange(event.target.valueAsNumber)} />
    </label>
  );
}

export function DecorationLayoutEditor({ value, textEnabled, textureEnabled, onChange }: Props) {
  const [scaleBothAxes, setScaleBothAxes] = useState(true);
  const text = value?.text ?? DEFAULT_TEXT_LAYOUT;
  const texture = value?.texture ?? DEFAULT_TEXTURE_LAYOUT;
  function resizeTexture(axis: 'width' | 'height', size: number) {
    onChange({
      ...value,
      texture: { ...texture, [axis]: size, ...(scaleBothAxes ? { width: size, height: size } : {}) },
    });
  }
  function reset(key: keyof DecorationLayout) {
    const { [key]: _removed, ...rest } = value ?? {};
    onChange(Object.keys(rest).length ? rest : undefined);
  }
  return (
    <div>
      <p className="muted">{t("Positions use the unwrapped model surface: X 50% faces front, X 0%/100% meets at the back; Y 0% is the bottom and Y 100% the top. Content outside the height is clipped. Generic box previews use the front face's coordinates.")}</p>
      {textEnabled && (
        <fieldset className="option-group">
          <legend>{t("Text placement")}</legend>
          <div className="form-grid">
            <PercentControl label={t("Text horizontal anchor")} value={text.centerX} onChange={(centerX) => onChange({ ...value, text: { ...text, centerX } })} />
            <PercentControl label={t("Text vertical anchor")} value={text.centerY} onChange={(centerY) => onChange({ ...value, text: { ...text, centerY } })} />
            <label className="field">
              <span>{t("Horizontal text alignment")}</span>
              <select value={text.horizontalAlign} onChange={(event) => {
                const horizontalAlign = event.target.value;
                if (horizontalAlign === 'left' || horizontalAlign === 'center' || horizontalAlign === 'right') {
                  onChange({ ...value, text: { ...text, horizontalAlign } });
                }
              }}>
                <option value="left">{t("Left")}</option><option value="center">{t("Center")}</option><option value="right">{t("Right")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("Vertical text alignment")}</span>
              <select value={text.verticalAlign} onChange={(event) => {
                const verticalAlign = event.target.value;
                if (verticalAlign === 'top' || verticalAlign === 'middle' || verticalAlign === 'bottom') {
                  onChange({ ...value, text: { ...text, verticalAlign } });
                }
              }}>
                <option value="top">{t("Top")}</option><option value="middle">{t("Middle")}</option><option value="bottom">{t("Bottom")}</option>
              </select>
            </label>
          </div>
          <p className="muted">{t("Each line aligns to the horizontal anchor; the whole text block aligns to the vertical anchor.")}</p>
          <button type="button" className="btn btn--small btn--ghost" disabled={!value?.text} onClick={() => reset('text')}>{t("Reset text placement")}</button>
        </fieldset>
      )}
      {textureEnabled && (
        <fieldset className="option-group">
          <legend>{t("Texture placement")}</legend>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={scaleBothAxes}
              onChange={(event) => {
                const enabled = event.target.checked;
                setScaleBothAxes(enabled);
                if (enabled && texture.height !== texture.width) {
                  onChange({ ...value, texture: { ...texture, height: texture.width } });
                }
              }}
            />{t("Scale both axes together")}</label>
          <p className="muted">{t("Size changes use the same percentage on both axes while linked. Enabling this sets height to the current width.")}</p>
          <div className="form-grid">
            <PercentControl label={t("Texture horizontal center")} value={texture.centerX} onChange={(centerX) => onChange({ ...value, texture: { ...texture, centerX } })} />
            <PercentControl label={t("Texture vertical center")} value={texture.centerY} onChange={(centerY) => onChange({ ...value, texture: { ...texture, centerY } })} />
            <PercentControl label={t("Texture width")} value={texture.width} min={1} onChange={(width) => resizeTexture('width', width)} />
            <PercentControl label={t("Texture height")} value={texture.height} min={1} onChange={(height) => resizeTexture('height', height)} />
          </div>
          <p className="muted">{t("Size is a percentage of surface width/height. Editing a texture setting places one image instead of tiling it.")}</p>
          <button type="button" className="btn btn--small btn--ghost" disabled={!value?.texture} onClick={() => reset('texture')}>{t("Reset to repeating texture")}</button>
        </fieldset>
      )}
    </div>
  );
}
