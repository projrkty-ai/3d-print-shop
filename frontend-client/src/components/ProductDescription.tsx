import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { resolveAssetUrl } from '../api/urls';
import type { Product, ProductMedia } from '../types';
import { prepareDescription, videoEmbedUrl } from '../utils/productDescription';

function MediaSlide({ item }: { item: ProductMedia }) {
  const [failed, setFailed] = useState(false);
  const embed = item.type === 'video' ? videoEmbedUrl(item.url) : null;
  if (failed) return <p role="alert">{t(item.type === 'image'
    ? 'This image could not be loaded. Check the media link or try again later.'
    : 'This video could not be loaded. Check the media link or try again later.')}</p>;
  if (embed) return <iframe src={embed} title={item.alt || t("Product video")} allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
  if (item.type === 'video') return <video src={resolveAssetUrl(item.url)} controls preload="metadata" aria-label={item.alt || t("Product video")} onError={() => setFailed(true)} />;
  return <img src={resolveAssetUrl(item.url)} alt={item.alt} onError={() => setFailed(true)} />;
}

function MediaCarousel({ media }: { media: ProductMedia[] }) {
  const [slide, setSlide] = useState<{
    index: number; previous: number | null; direction: -1 | 1; step: number;
  }>({ index: 0, previous: null, direction: 1, step: 0 });
  const { index, previous, direction, step } = slide;
  const item = media[index];
  if (!item) return null;
  const select = (nextDirection: -1 | 1) => setSlide((current) => ({
    index: (current.index + nextDirection + media.length) % media.length,
    previous: media[current.index].type === 'image' ? current.index : null,
    direction: nextDirection,
    step: current.step + 1,
  }));
  return (
    <section className={`media-carousel${media.length > 1 ? ' media-carousel--multiple' : ''}`}
      data-direction={direction > 0 ? 'next' : 'previous'} data-media-type={item.type}
      aria-label={t("Product media")} aria-roledescription={t("carousel")}>
      <div className="media-carousel__viewport">
        <div key={`active:${step}`} data-active="true"
          className={`media-carousel__slide${step > 0 ? ' media-carousel__slide--incoming' : ''}`}
          role="group" aria-roledescription={t("slide")} aria-label={t("{value0} of {value1}", { value0: index + 1, value1: media.length })}>
          <MediaSlide item={item} />
        </div>
        {previous !== null && (
          <div key={`outgoing:${step}`} className="media-carousel__slide media-carousel__slide--outgoing" aria-hidden="true" inert
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setSlide((current) => current.step === step ? { ...current, previous: null } : current);
            }}>
            <img src={resolveAssetUrl(media[previous].url)} alt="" />
          </div>
        )}
        {media.length > 1 && (
          <>
            <button type="button" className="media-carousel__arrow media-carousel__arrow--previous" aria-label={t("Previous media")} onClick={() => select(-1)}>
              <span className="media-carousel__arrow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" focusable="false"><path d="m15 5-7 7 7 7" /></svg>
              </span>
            </button>
            <button type="button" className="media-carousel__arrow media-carousel__arrow--next" aria-label={t("Next media")} onClick={() => select(1)}>
              <span className="media-carousel__arrow-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" focusable="false"><path d="m9 5 7 7-7 7" /></svg>
              </span>
            </button>
            <span className="media-carousel__counter" aria-live="polite" aria-atomic="true">{index + 1} / {media.length}</span>
          </>
        )}
      </div>
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
