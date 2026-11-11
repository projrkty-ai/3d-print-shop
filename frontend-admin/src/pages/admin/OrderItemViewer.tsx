import { t } from '../../i18n';
import { useEffect, useId, useRef } from 'react';
import { ConfigurationDetails } from '../../components/ConfiguredItem';
import { LazyProductPreview } from '../../components/LazyProductPreview';
import type { CatalogModel, OrderItem, Product } from '../../types';
import { configuredSurfaces, itemSurfaces } from '../../utils/configuredRender';
import { formatPrice } from '../../utils/pricing';
import { formatDimensions, nearestPrintable, previewScale, roundMm } from '../../utils/sizing';
import { orderedTextureUrl } from '../../utils/texture';

interface Props {
  item: OrderItem<CatalogModel>;
  /** The ordered product as it is now; its 3D model is drawn with the ordered choices. */
  product: Product | undefined;
  orderNumber: string;
  /** 1-based position of the item in the order. */
  position: number;
  onClose: () => void;
}

/**
 * The ordered print in 3D — every plate with the customer's colors, engraving and texture —
 * next to all of the item's order parameters, for checking a job before printing.
 */
export function OrderItemViewer({ item, product, orderNumber, position, onClose }: Props) {
  const { model } = item;
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const surfaces = product ? configuredSurfaces(model, product) : [];
  const shown = product ? nearestPrintable(product.model, model.customization.dimensions) : null;
  const scale = product && shown ? previewScale(product.model, shown) : ([1, 1, 1] as [number, number, number]);
  const caption = (plateId: number | null) => {
    const size = plateId === null ? undefined : product?.mesh?.plates.find((plate) => plate.id === plateId)?.model;
    return size ? formatDimensions({
      widthMm: roundMm(size.widthMm * scale[0]), depthMm: roundMm(size.depthMm * scale[2]), heightMm: roundMm(size.heightMm * scale[1]),
    }) : model.sizeLabel;
  };

  return (
    <div className="viewer-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="viewer card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="viewer__header">
          <div>
            <h2 id={titleId}>{model.productName}</h2>
            <p className="muted">{t("Order {0}, item {1}", orderNumber, position)}</p>
          </div>
          <button ref={closeButton} type="button" className="btn btn--ghost" onClick={onClose}>{t("Close")}</button>
        </div>
        <div className="viewer__layout">
          <div className="viewer__models">
            {product ? surfaces.map((surface) => (
              <figure key={surface.plate ?? 'print'} className="viewer__model">
                {surface.name && <figcaption><strong>{surface.name}</strong></figcaption>}
                <LazyProductPreview
                  shape={product.shape}
                  meshUrl={product.mesh?.url}
                  meshPlate={surface.plate ?? product.mesh?.plate}
                  meshPlates={surface.plate === null ? product.mesh?.selectedPlates : undefined}
                  partColors={surface.partColors}
                  color={surface.color}
                  engravingColor={surface.engravingColor}
                  scale={scale}
                  caption={caption(surface.plate)}
                  engravingText={surface.engravingText}
                  engravingFont={surface.engravingFont}
                  textureUrl={surface.textureUrl}
                  decorationLayout={surface.layout}
                  extrudedText={surface.extrudedText}
                />
              </figure>
            )) : (
              <p className="banner banner--warning">{t("This product no longer exists, so its 3D model can't be shown. All ordered parameters are listed here.")}</p>
            )}
            {product && <p className="muted">{t("Drawn on the product's current 3D model with the colors, text, texture and placement recorded in the order.")}</p>}
          </div>
          <div className="viewer__details">
            <h3>{t("Order parameters")}</h3>
            <ConfigurationDetails item={model} />
            <dl className="config-details">
              <dt>{t("Quantity")}</dt>
              <dd>{item.quantity}</dd>
              <dt>{t("Unit price")}</dt>
              <dd>{formatPrice(item.unitPrice ?? 0)}</dd>
              <dt>{t("Line total")}</dt>
              <dd><strong>{formatPrice(item.lineTotal ?? 0)}</strong></dd>
            </dl>
            <table className="summary__lines">
              <caption className="muted">{t("Price breakdown")}</caption>
              <tbody>
                {model.priceLines.map((line) => (
                  <tr key={line.label}>
                    <td>
                      {line.label}
                      {line.note && <small className="summary__note">{line.note}</small>}
                    </td>
                    <td>{formatPrice(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <OrderedTextures item={model} fileName={`${orderNumber}-${position}`} />
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The texture to print on each surface, large enough to check: the shop texture snapshotted at
 * checkout (with its full-resolution original) or the customer's uploaded picture (downloadable).
 */
export function OrderedTextures({ item, fileName }: { item: CatalogModel; fileName: string }) {
  return itemSurfaces(item).map(({ plate, appearance, choices }) => {
    const url = orderedTextureUrl(appearance, choices);
    if (!url) return null;
    const library = appearance.texture?.source === 'library' ? appearance.texture : null;
    const extension = /^data:image\/(png|jpeg|webp);/.exec(url)?.[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    return (
      <figure key={plate?.id ?? 'item'} className="order-item__texture">
        <img
          src={url}
          alt={library
            ? t("Shop texture {0} for {1}", library.name, plate ? `${item.productName}, ${plate.name}` : item.productName)
            : plate ? t("Texture uploaded for {0}, {1}", item.productName, plate.name) : t("Texture uploaded for {0}", item.productName)}
        />
        <figcaption className="muted">
          {plate && `${plate.name}: `}
          {library ? t("Shop texture: {0}", library.name) : t("Customer's texture picture")}
          {' · '}
          {library ? (
            <a href={url} target="_blank" rel="noopener noreferrer">{t("Open original")}</a>
          ) : (
            <a href={url} download={`${fileName}${plate ? `-plate-${plate.id}` : ''}-texture.${extension}`}>{t("Download")}</a>
          )}
        </figcaption>
      </figure>
    );
  });
}
