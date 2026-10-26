import { t } from '../../i18n';
import { useId } from 'react';
import type { MeshPart, Product, SurfaceCustomization } from '../../types';
import { ColorSelector } from './ColorSelector';
import { EngravingInput } from './EngravingInput';
import { TextureUpload } from './TextureUpload';

interface Props {
  product: Product;
  parts: MeshPart[];
  value: SurfaceCustomization;
  error: string | null;
  onChange: (patch: Partial<SurfaceCustomization>) => void;
  perSet?: boolean;
}

export function SurfaceOptions({ product, parts, value, error, onChange, perSet = false }: Props) {
  const id = useId();
  const color = product.colors.find((color) => color.id === value.colorId);
  function choosePartColor(key: string, colorId: string | null) {
    const { [key]: _previous, ...others } = value.partColors;
    onChange({ partColors: colorId ? { ...others, [key]: colorId } : others });
  }
  return (
    <div>
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
      {product.texture.enabled && (
        <TextureUpload
          config={product.texture}
          value={value.textureDataUrl}
          onChange={(textureDataUrl) => onChange({ textureDataUrl })}
          priceScope={perSet ? t("per set") : undefined}
        />
      )}
    </div>
  );
}
