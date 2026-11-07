import { useState } from 'react';
import { t } from '../i18n';
import type { ModelSearchResult } from '../types';
import { formatPrice } from '../utils/pricing';

export const MODEL_SOURCE_LABELS: Record<ModelSearchResult['source'], string> = {
  thingiverse: 'Thingiverse',
  printables: 'Printables',
  makerworld: 'MakerWorld',
};

interface Props {
  model: ModelSearchResult;
  /** Whether this model is the one in the order form. */
  selected?: boolean;
  /** Called on any click in the card (including the link): the form follows the last clicked model. */
  onSelect?: (model: ModelSearchResult) => void;
  /** Fixed price of a ready-to-print product. */
  price?: number;
}

/** One external model, drawn the same way whichever site it comes from; links to the original posting. */
export function ModelSearchCard({ model, selected = false, onSelect, price }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const site = MODEL_SOURCE_LABELS[model.source] ?? model.source;
  return (
    <article className={`model-result${selected ? ' is-selected' : ''}`} onClick={() => onSelect?.(model)} data-selected={selected || undefined}>
      <div className="model-result__media">
        {model.thumbnailUrl && !imageFailed ? (
          <img src={model.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)} />
        ) : (
          <span className="model-result__placeholder" aria-hidden="true">◆</span>
        )}
        <span className={`source-badge source-badge--${model.source}`}>{site}</span>
      </div>
      <div className="model-result__body">
        <h2 className="model-result__title">{model.title}</h2>
        {model.author && <p className="model-result__author">{t('by {author}', { author: model.author })}</p>}
        {model.description && <p className="model-result__description">{model.description}</p>}
        {price !== undefined && <p className="model-result__price">{t('Printed for {price}', { price: formatPrice(price) })}</p>}
        <div className="model-result__actions">
          {onSelect && (
            <button type="button" className={`btn btn--small${selected ? ' btn--primary' : ''}`} aria-pressed={selected}>
              {selected ? t('Selected for order') : t('Order this')}
            </button>
          )}
          <a className="model-result__link" href={model.url} target="_blank" rel="noopener noreferrer">
            {t('View on {site}', { site })} <span aria-hidden="true">↗</span>
            <span className="visually-hidden"> {t('(opens in a new tab)')}</span>
          </a>
        </div>
      </div>
    </article>
  );
}
