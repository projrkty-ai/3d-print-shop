import { alignmentLabel, formatCount, formatNumber, t } from '../i18n';
import { fontStack } from '../config';
import type { AppearanceSummary, CartItem, SurfaceCustomization } from '../types';

/** The parts of a cart item or order item that describe what the customer configured. */
type Configured = Pick<CartItem, 'customization' | 'sizeLabel' | 'colorName' | 'colorHex' | 'parts' | 'plates' | 'engravingColor' | 'decorationLayout'>;

/** Solid color, or diagonal bands of each part's color for multi-color prints. */
function swatchBackground(item: Configured): string {
  const appearances = item.plates?.flatMap((plate) => plate.appearance ? [plate.appearance] : []) ?? [];
  const colors = (appearances.length ? appearances : [item])
    .flatMap((appearance) => appearance.parts?.map((part) => part.colorHex) ?? [appearance.colorHex]);
  if (colors.length === 1) return colors[0];
  const band = 100 / colors.length;
  const stops = colors.map((color, i) => `${color} ${i * band}% ${(i + 1) * band}%`);
  return `linear-gradient(135deg, ${stops.join(', ')})`;
}

/** Color thumbnail, overlaid with the customer's texture picture if there is one. */
export function ItemSwatch({ item }: { item: Configured }) {
  const textureDataUrl = item.customization.plates
    ? Object.values(item.customization.plates).find((choices) => choices.textureDataUrl)?.textureDataUrl
    : item.customization.textureDataUrl;
  return (
    <div className="cart-item__swatch" style={{ background: swatchBackground(item) }}>
      {textureDataUrl && <img src={textureDataUrl} alt={t("Custom texture")} />}
    </div>
  );
}

/** Size, colors, engraving and texture as a definition list. */
export function ConfigurationDetails({ item }: { item: Configured }) {
  const plateAppearances = item.plates?.some((plate) => plate.appearance);
  return (
    <dl className="config-details">
      <dt>{t("Size")}</dt>
      <dd>{item.sizeLabel}</dd>
      {item.plates && (
        <>
          <dt>{t("Included plates")}</dt>
          <dd>
            {plateAppearances ? item.plates.map((plate) => (
              <section key={plate.id} aria-label={t("Plate configuration: {0}", plate.name)}>
                <h4>{plate.name} ({formatCount('object', plate.objectCount)})</h4>
                <dl className="config-details">
                  <AppearanceDetails
                    appearance={plate.appearance ?? item}
                    choices={item.customization.plates?.[plate.id] ?? item.customization}
                  />
                </dl>
              </section>
            )) : item.plates.map((plate) => `${plate.name} (${formatCount('object', plate.objectCount)})`).join(', ')}
          </dd>
        </>
      )}
      {!plateAppearances && <AppearanceDetails appearance={item} choices={item.customization} />}
    </dl>
  );
}

function AppearanceDetails({ appearance, choices }: { appearance: AppearanceSummary; choices: SurfaceCustomization }) {
  const { engravingText, engravingFont, textureDataUrl } = choices;
  return (
    <>
      {appearance.parts ? (
        <>
          <dt>{t("Colors")}</dt>
          <dd>
            <ul className="cart-item__parts">
              {appearance.parts.map((part, i) => (
                <li key={i}>
                  <span className="cart-item__dot" style={{ background: part.colorHex }} />
                  {part.name}: {part.colorName}
                </li>
              ))}
            </ul>
          </dd>
        </>
      ) : (
        <>
          <dt>{t("Color")}</dt>
          <dd>{appearance.colorName}</dd>
        </>
      )}
      {engravingText && (
        <>
          <dt>{t("Engraving")}</dt>
          <dd>
            <span className="cart-item__engraving" style={{ fontFamily: fontStack(engravingFont) }}>
              “{engravingText}”
            </span>
            {appearance.engravingColor && (
              <div>
                <span className="cart-item__dot" style={{ background: appearance.engravingColor.hex }} />{t("in")} {appearance.engravingColor.name}
              </div>
            )}
            {appearance.decorationLayout?.text && (
              <small className="muted">{t("Anchor")} {formatNumber(appearance.decorationLayout.text.centerX)}% / {formatNumber(appearance.decorationLayout.text.centerY)}% ·{' '}
                {alignmentLabel(appearance.decorationLayout.text.horizontalAlign)} / {alignmentLabel(appearance.decorationLayout.text.verticalAlign)}
              </small>
            )}
          </dd>
        </>
      )}
      {textureDataUrl && (
        <>
          <dt>{t("Texture")}</dt>
          <dd>{t("Custom picture")}{appearance.decorationLayout?.texture && (
              <small className="muted">
                {' '}{t("Center")} {formatNumber(appearance.decorationLayout.texture.centerX)}% / {formatNumber(appearance.decorationLayout.texture.centerY)}% ·{' '}
                {formatNumber(appearance.decorationLayout.texture.width)}% × {formatNumber(appearance.decorationLayout.texture.height)}%
              </small>
            )}
          </dd>
        </>
      )}
    </>
  );
}
