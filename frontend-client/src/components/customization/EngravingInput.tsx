import { t } from '../../i18n';
import { useId } from 'react';
import { fontStack } from '../../config';
import type { ColorOption, EngravingConfig } from '../../types';
import { engravingCharCount, engravingLines } from '../../utils/engraving';
import { formatPrice } from '../../utils/pricing';
import { ColorSelector } from './ColorSelector';

interface Props {
  config: EngravingConfig;
  text: string;
  font: string;
  error: string | null;
  onTextChange: (text: string) => void;
  onFontChange: (font: string) => void;
  /** Filament colors the letters can be filled with (used when `config.colorChoice` is on). */
  colors: ColorOption[];
  colorId: string | null;
  onColorChange: (colorId: string | null) => void;
  /** Print color to show on the "Same as print" swatch; omitted for multi-color models. */
  printColorHex?: string;
  priceScope?: string;
}

export function EngravingInput({
  config,
  text,
  font,
  error,
  onTextChange,
  onFontChange,
  colors,
  colorId,
  onColorChange,
  printColorHex,
  priceScope,
}: Props) {
  const id = useId();
  const textColor = colors.find((c) => c.id === colorId);
  const multiline = config.maxLines > 1;
  const lineCount = engravingLines(text).length;
  const sharedProps = {
    id: `${id}-text`,
    value: text,
    'aria-invalid': error !== null,
    'aria-describedby': `${id}-help`,
  };

  return (
    <fieldset className="option-group">
      <legend>
        {t("Engraving")} <span className="option-group__price">+{formatPrice(config.price)} {priceScope}</span>
      </legend>
      <div className="engraving">
        <div className="field">
          <label htmlFor={`${id}-text`}>
            {multiline ? t('Text (optional, up to {value0} lines)', { value0: config.maxLines }) : t('Text (optional)')}
          </label>
          {multiline ? (
            <textarea
              {...sharedProps}
              rows={config.maxLines}
              placeholder={t("e.g. Happy Birthday\nAnna")}
              onChange={(e) => onTextChange(e.target.value)}
            />
          ) : (
            <input
              {...sharedProps}
              type="text"
              // Allow typing a little past the limit so the error is visible instead of silently truncating.
              maxLength={config.maxLength + 5}
              placeholder={t("e.g. Happy Birthday Anna!")}
              onChange={(e) => onTextChange(e.target.value)}
            />
          )}
          <div id={`${id}-help`} className={`field__help ${error ? 'is-error' : ''}`}>
            {error ?? (multiline ? t("Press Enter for a new line. Leave empty for no engraving.") : t("Leave empty for no engraving."))}
            <span className="field__counter">
              {multiline && t("{value0}/{value1} lines · ", { value0: lineCount, value1: config.maxLines })}
              {engravingCharCount(text)}/{config.maxLength}
            </span>
          </div>
        </div>
        {config.fonts.length > 1 && (
          <div className="field">
            <label htmlFor={`${id}-font`}>{t("Font")}</label>
            <select id={`${id}-font`} value={font} onChange={(e) => onFontChange(e.target.value)}>
              {config.fonts.map((f) => (
                <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        )}
        {config.colorChoice && text.trim() && (
          <div className="engraving__color">
            <ColorSelector
              legend={t("Text color")}
              name={`${id}-engraving-color`}
              colors={colors}
              value={colorId}
              onChange={onColorChange}
              original={{ hex: printColorHex, label: t("Same as print"), description: t("engraved in the print color") }}
            />
            {config.colorPrice > 0 && (
              <p className="option-group__desc">{t("Colored text +")}{formatPrice(config.colorPrice)} {priceScope}</p>
            )}
          </div>
        )}
        {text.trim() && (
          <div
            className={`engraving__sample ${textColor ? 'engraving__sample--colored' : ''}`}
            // Colored letters are shown on the print color when there is a single one.
            style={{ fontFamily: fontStack(font), color: textColor?.hex, background: textColor ? printColorHex : undefined }}
          >
            {engravingLines(text).join('\n')}
          </div>
        )}
      </div>
    </fieldset>
  );
}
