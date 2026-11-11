import { t } from '../../i18n';
import { useId } from 'react';
import type { DecorationLayout, MeshPart, MeshPlate, Product, SurfaceCustomization } from '../../types';
import { ColorSelector } from './ColorSelector';
import { EngravingInput } from './EngravingInput';
import { ExtrudedTextInput } from './ExtrudedTextInput';
import { TexturePicker } from './TexturePicker';
import { VariantSelector } from './VariantSelector';

interface Props {
  product: Product;
  parts: MeshPart[];
  value: SurfaceCustomization;
  error: string | null;
  /** The shop's placement for this surface, offering 3D lettering when set. */
  decorationLayout?: DecorationLayout;
  /** Problem with the 3D lettering text, if any. */
  extrudedError?: string | null;
  onChange: (patch: Partial<SurfaceCustomization>) => void;
  perSet?: boolean;
  /** The plate these options apply to (null: a model without plates), for its print variants. */
  plate?: Pick<MeshPlate, 'id'> | null;
  /** Uniform scale of the print, to show each print variant's price at the chosen size. */
  printScale?: number | null;
}

export function SurfaceOptions({ product, parts, value, error, decorationLayout, extrudedError = null, onChange, perSet = false, plate = null, printScale = null }: Props) {
  const id = useId();
  const color = product.colors.find((color) => color.id === value.colorId);
  function choosePartColor(key: string, colorId: string | null) {
    const { [key]: _previous, ...others } = value.partColors;
    onChange({ partColors: colorId ? { ...others, [key]: colorId } : others });
  }
  return (
    <div>
      <VariantSelector product={product} plate={plate} value={value} scale={printScale} name={`${id}-variant`}
        onChange={(variantId) => onChange({ variantId })} />
      {parts.length > 0 ? (
        <div className="part-colors">
          <div className="part-colors__header">
            <h3>{t("Colors")}</h3>
            {Object.keys(value.partColors).length > 0 && (
              <button type="button" className="btn btn--small btn--ghost" onClick={() => onChange({ partColors: {} })}>{t("Reset to original colors")}</button>
            )}
          </div>
          <p className="option-group__desc">{t("Each part starts in the designer's colors. Pick a filament to change any part on its own.")}</p>
          {parts.map((part) => (
            <ColorSelector
              key={part.key}
              legend={part.name}
              name={`${id}-part-${part.key}`}
              colors={product.colors}
              value={value.partColors[part.key] ?? null}
              original={{ hex: part.fileColor }}
              onChange={(colorId) => choosePartColor(part.key, colorId)}
            />
          ))}
        </div>
      ) : (
        <ColorSelector
          name={`${id}-color`}
          colors={product.colors}
          value={value.colorId}
          onChange={(colorId) => colorId && onChange({ colorId })}
        />
      )}
      {product.engraving.enabled && (
        <EngravingInput
          config={product.engraving}
          text={value.engravingText}
          font={value.engravingFont}
          error={error}
          onTextChange={(engravingText) => onChange({ engravingText })}
          onFontChange={(engravingFont) => onChange({ engravingFont })}
          colors={product.colors}
          colorId={value.engravingColorId}
          onColorChange={(engravingColorId) => onChange({ engravingColorId })}
          printColorHex={parts.length > 0 ? undefined : color?.hex}
          priceScope={perSet ? t("per set") : undefined}
        />
      )}
      {decorationLayout?.extrudedText && (
        <ExtrudedTextInput
          layout={decorationLayout.extrudedText}
          text={value.extrudedText}
          sizeMm={value.extrudedSizeMm}
          error={extrudedError}
          onChange={onChange}
        />
      )}
      <TexturePicker
        config={product.texture}
        value={value}
        onChange={onChange}
        name={`${id}-texture`}
        priceScope={perSet ? t("per set") : undefined}
      />
    </div>
  );
}
