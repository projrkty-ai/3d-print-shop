import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { resolveAssetUrl } from '../api/urls';
import type { Product, ProductMedia } from '../types';
import { prepareDescription, videoEmbedUrl } from '../utils/productDescription';

function MediaSlide({ item }: { item: ProductMedia }) {
  const [failed, setFailed] = useState(false);
  const embed = item.type === 'video' ? videoEmbedUrl(item.url) : null;
  if (failed) return <p role="alert">{t('This {0} could not be loaded. Check the media link or try again later.', item.type === 'image' ? t('image') : t('video'))}</p>;
  if (embed) return <iframe src={embed} title={item.alt || t("Product video")} allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
  if (item.type === 'video') return <video src={resolveAssetUrl(item.url)} controls preload="metadata" aria-label={item.alt || t("Product video")} onError={() => setFailed(true)} />;
  return <img src={resolveAssetUrl(item.url)} alt={item.alt} onError={() => setFailed(true)} />;
}

function MediaCarousel({ media }: { media: ProductMedia[] }) {
  const [index, setIndex] = useState(0);
  const item = media[index];
  if (!item) return null;
  const select = (next: number) => setIndex((next + media.length) % media.length);
  return (
    <section className="media-carousel" aria-label={t("Product media")} aria-roledescription={t('carousel')}>
      <div className="media-carousel__slide" role="group" aria-roledescription={t('slide')} aria-label={t('{0} of {1}', index + 1, media.length)}>
        <MediaSlide key={`${item.type}:${item.url}`} item={item} />
      </div>
      {media.length > 1 && (
        <>
          <div className="media-carousel__navigation">
            <button type="button" className="btn btn--small btn--ghost" aria-label={t("Previous media")} onClick={() => select(index - 1)}>{t("Previous")}</button>
            <span aria-live="polite" aria-atomic="true">{index + 1} / {media.length}</span>
            <button type="button" className="btn btn--small btn--ghost" aria-label={t("Next media")} onClick={() => select(index + 1)}>{t("Next")}</button>
          </div>
          <div className="media-carousel__pages" aria-label={t("Choose media")}>
            {media.map((entry, position) => (
              <button key={`${entry.type}:${entry.url}`} type="button"
                aria-label={t("Show {0} {1}: {2}", entry.type === 'image' ? t('image') : t('video'), position + 1, entry.alt || t("Product media"))}
                aria-current={position === index ? 'true' : undefined}
                onClick={() => select(position)}>{position + 1} · {entry.type === 'image' ? t("Image") : t("Video")}</button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function ProductDescription({ product }: { product: Product }) {
  const content = useMemo(() => prepareDescription(product), [
    product.description, product.descriptionFormat, product.gallery, product.imageUrl, product.name,
  ]);
  return (
    <div className="product-description">
      <MediaCarousel key={JSON.stringify(content.media)} media={content.media} />
      <div className="rich-description" dangerouslySetInnerHTML={{ __html: content.html }} />
    </div>
  );
}
