import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { LoadState } from '../components/LoadState';
import { MODEL_SOURCE_LABELS, ModelSearchCard } from '../components/ModelSearchCard';
import { emptyCustomer } from '../components/CustomerFields';
import { ReadyProductDialog } from '../components/ReadyProductDialog';
import { t } from '../i18n';
import type { Customer, ModelSearchResult, ProjectOrder, ReadyProduct } from '../types';
import { formatPrice } from '../utils/pricing';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; products: ReadyProduct[] };

/** A product shown with the same card as search results; its id is the product's. */
const asCard = (product: ReadyProduct): ModelSearchResult => ({
  source: product.project.source,
  id: product.id,
  title: product.title,
  description: product.description,
  thumbnailUrl: product.project.thumbnailUrl,
  url: product.project.url,
  author: product.project.author,
});

/** Projects the shop has already reviewed, offered at a fixed printing price. */
export function ReadyToPrintPage() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  /** The last order sent, shown until another product is chosen. */
  const [placed, setPlaced] = useState<{ order: ProjectOrder; productId: string } | null>(null);
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const orderButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    api.listReadyProducts().then(
      (products) => !cancelled && setLoad({ status: 'ready', products }),
      (err: unknown) => !cancelled && setLoad({ status: 'error', message: err instanceof ApiError ? err.message : t('Could not load the ready-to-print projects.') }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const closeDialog = useCallback(() => {
    setOrdering(false);
    orderButton.current?.focus();
  }, []);

  const products = load.status === 'ready' ? load.products : [];
  const selected = products.find((product) => product.id === selectedId) ?? null;
  const confirmation = placed && placed.productId === selectedId ? placed.order : null;
  const select = (card: ModelSearchResult) => setSelectedId(card.id);

  return (
    <div className="model-search-page">
      <section className="hero">
        <h1>{t('Ready to print')}</h1>
        <p>{t('Designs from Thingiverse, Printables and MakerWorld that we have already prepared, with a fixed printing price.')}</p>
      </section>
      <div className="model-search-page__layout">
        <div className="model-search-page__results">
          {load.status !== 'ready' ? (
            <LoadState load={load} onRetry={() => setAttempt((n) => n + 1)} loadingText={t('Loading ready-to-print projects…')} />
          ) : products.length === 0 ? (
            <div className="empty-state"><p>{t('No ready-to-print projects yet. Search for a model and ask us to print it.')}</p></div>
          ) : (
            <>
              <p className="muted model-search-page__note">
                {t('These models are published by their designers on other websites. Check each model’s license there.')}
              </p>
              <div className="catalog-grid model-results">
                {products.map((product) => (
                  <ModelSearchCard key={product.id} model={asCard(product)} price={product.price.total}
                    selected={product.id === selectedId} onSelect={select} />
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="card project-order" aria-label={t('Order a ready-to-print project')}>
          <h2>{t('Order a ready-to-print project')}</h2>
          {confirmation ? (
            <div className="banner banner--success" role="status">
              <strong>{t('Order {number} received.', { number: confirmation.number })}</strong>
              <p>
                {confirmation.requiresQuote || !confirmation.review
                  ? t('With the changed materials we need to quote it first; we will email the price to {email}.', { email: confirmation.customer.email })
                  : t('We will print it for {price} and contact you at {email}.', { price: formatPrice(confirmation.review.total), email: confirmation.customer.email })}
              </p>
            </div>
          ) : (
            <p className="muted">{t('Pick a project on the left. The price covers printing as shown; no quote needed.')}</p>
          )}
          {selected ? (
            <>
              <div className="project-order__project">
                <div className="project-order__thumb">
                  {selected.project.thumbnailUrl ? <img src={selected.project.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">◆</span>}
                </div>
                <div>
                  <span className={`source-badge source-badge--${selected.project.source}`}>{MODEL_SOURCE_LABELS[selected.project.source]}</span>
                  <h3 className="project-order__title">{selected.title}</h3>
                  {selected.project.author && <p className="muted">{t('Design by {author}', { author: selected.project.author })}</p>}
                  {selected.project.license && <p className="muted">{t('License: {license}', { license: selected.project.license })}</p>}
                  <p className="project-order__price">{formatPrice(selected.price.total)}</p>
                  <a href={selected.project.url} target="_blank" rel="noopener noreferrer">
                    {t('View on {site}', { site: MODEL_SOURCE_LABELS[selected.project.source] })} <span aria-hidden="true">↗</span>
                    <span className="visually-hidden"> {t('(opens in a new tab)')}</span>
                  </a>
                </div>
              </div>
              <button ref={orderButton} type="button" className="btn btn--primary btn--large project-order__submit" onClick={() => setOrdering(true)}>
                {t('Order for {price}…', { price: formatPrice(selected.price.total) })}
              </button>
            </>
          ) : (
            <p className="project-order__empty">{t('No project selected yet. Click a project on the left.')}</p>
          )}
        </aside>
      </div>

      {ordering && selected && (
        <ReadyProductDialog product={selected} customer={customer} onCustomerChange={setCustomer} onClose={closeDialog}
          onPlaced={(order) => {
            setPlaced({ order, productId: selected.id });
            setOrdering(false);
          }} />
      )}
    </div>
  );
}
