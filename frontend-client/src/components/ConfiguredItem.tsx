import { t } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { fontStack } from '../config';
import type { AppearanceSummary, Product, SurfaceCustomization } from '../types';
import { configuredModel, itemSurfaces, type Configured } from '../utils/configuredRender';
import { extrudedTextChoice } from '../utils/customization';
import { orderedTextureUrl } from '../utils/texture';

export { itemSurfaces };

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

const canRenderModels = () => typeof window !== 'undefined' && 'WebGLRenderingContext' in window;

/**
 * Picture of the configured print — its model in the chosen colors with the engraving and texture —
 * rendered off-screen. Shows the color swatch while rendering, or when the product no longer exists.
 */
export function ItemThumbnail({ item, product, onOpen }: { item: Configured; product?: Product; onOpen?: () => void }) {
  const model = useMemo(() => (product && canRenderModels() ? configuredModel(item, product) : null), [item, product]);
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    setImage(null);
    if (!model) return;
    let cancelled = false;
    import('../utils/modelThumbnail')
      .then(({ configuredThumbnail }) => configuredThumbnail(model))
      .then((rendered) => !cancelled && setImage(rendered))
      .catch((error: unknown) => console.warn('Could not render the configured print', error));
    return () => { cancelled = true; };
  }, [model]);
  const picture = image
    ? <div className="cart-item__swatch cart-item__swatch--model"><img src={image} alt={t("Your configured print")} /></div>
    : <ItemSwatch item={item} />;
  return onOpen ? (
    <button type="button" className="item-thumbnail__open" onClick={onOpen} aria-label={t("Show the configured print in 3D")}>
      {picture}
    </button>
  ) : picture;
}

/** Color thumbnail, overlaid with the first applied texture (shop texture or customer picture). */
export function ItemSwatch({ item }: { item: Configured }) {
  const textureUrl = itemSurfaces(item).map(({ appearance, choices }) => orderedTextureUrl(appearance, choices)).find(Boolean);
  return (
    <div className="cart-item__swatch" style={{ background: swatchBackground(item) }}>
      {textureUrl && <img src={textureUrl} alt={t("Texture")} />}
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
              <section key={plate.id} aria-label={t("Plate configuration: {value0}", { value0: plate.name })}>
                <h4>{plate.name} ({t('{count} objects', { count: plate.objectCount })})</h4>
                <dl className="config-details">
                  <AppearanceDetails
                    appearance={plate.appearance ?? item}
                    choices={item.customization.plates?.[plate.id] ?? item.customization}
                  />
                </dl>
              </section>
            )) : item.plates.map((plate) => `${plate.name} (${t('{count} objects', { count: plate.objectCount })})`).join(', ')}
          </dd>
        </>
      )}
      {!plateAppearances && <AppearanceDetails appearance={item} choices={item.customization} />}
    </dl>
  );
}

function AppearanceDetails({ appearance, choices }: { appearance: AppearanceSummary; choices: SurfaceCustomization }) {
  const { engravingText, engravingFont } = choices;
  const textureUrl = orderedTextureUrl(appearance, choices);
  const lettering = extrudedTextChoice(appearance.decorationLayout, choices);
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
                <span className="cart-item__dot" style={{ background: appearance.engravingColor.hex }} />
                {t("in")} {appearance.engravingColor.name}
              </div>
            )}
            {appearance.decorationLayout?.text && (
              <small className="muted">
                {t("Anchor")} {appearance.decorationLayout.text.centerX}% / {appearance.decorationLayout.text.centerY}% ·{' '}
                {t(appearance.decorationLayout.text.horizontalAlign)} / {t(appearance.decorationLayout.text.verticalAlign)}
              </small>
            )}
          </dd>
        </>
      )}
      {lettering && (
        <>
          <dt>{t("3D lettering")}</dt>
          <dd>
            <span className="cart-item__engraving">“{lettering.text}”</span> · {lettering.sizeMm} mm
          </dd>
        </>
      )}
      {textureUrl && (
        <>
          <dt>{t("Texture")}</dt>
          <dd>
            <img className="config-details__texture" src={textureUrl} alt="" />
            {appearance.texture?.source === 'library'
              ? t("Shop texture: {value0}", { value0: appearance.texture.name })
              : t("Custom picture")}
            {appearance.decorationLayout?.texture && (
              <small className="muted">
                {' '}{t("Center")} {appearance.decorationLayout.texture.centerX}% / {appearance.decorationLayout.texture.centerY}% ·{' '}
                {appearance.decorationLayout.texture.width}% × {appearance.decorationLayout.texture.height}%
              </small>
            )}
          </dd>
        </>
      )}
    </>
  );
}
