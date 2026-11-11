import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { MAX_QUANTITY } from '../config';
import { t } from '../i18n';
import {
  PROJECT_MATERIALS, type Customer, type FilamentChoice, type ProjectMaterial, type Order, type ReadyPrintChoice, type ReadyPrintOptions,
  type ReadyProduct, type ReadyQuote,
} from '../types';
import { LOCALE } from '../config';
import { formatDimensions } from '../utils/sizing';
import { COLOR_MAX_LENGTH } from '../utils/projectOrderDraft';
import { formatPrice } from '../utils/pricing';
import { CustomerFields, customerForApi, Field } from './CustomerFields';
import { Dialog } from './Dialog';
import { MODEL_SOURCE_LABELS } from './ModelSearchCard';
import { formatFileSize } from './ProjectOrderDialog';
import { COLOR_SUGGESTIONS, MATERIAL_LABELS } from './PrintSettingsEditor';

/** Price of `sets` copies: the handling fee once, every set at its print price. */
export const totalForSets = (product: ReadyProduct, sets: number) =>
  Math.round((product.price.handlingFee + sets * product.price.setPrice) * 100) / 100;

const offeredChoices = (product: ReadyProduct) => product.items.map((item) => item.settings.filaments.map((filament) => ({ ...filament })));

/** Key of a plate in a print choice: its id, or `model` for a file without plates. */
const plateKey = (plateId: number | null) => (plateId === null ? 'model' : String(plateId));

/** The default print: every plate's default variant at the original size (or the nearest allowed). */
function defaultChoice(options: ReadyPrintOptions): ReadyPrintChoice {
  return {
    scale: Math.min(options.scale.max, Math.max(options.scale.min, 1)),
    variants: Object.fromEntries(options.plates.map((plate) => [plateKey(plate.plateId), plate.defaultVariantId ?? plate.variants[0]?.id ?? ''])),
  };
}

const mm = (value: number) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(value);

type QuoteState = { status: 'loading'; quote: ReadyQuote | null } | { status: 'ready'; quote: ReadyQuote } | { status: 'error'; message: string };

/** The shop's price for the chosen sets, variants and scale, asked for again when they change. */
function useQuote(product: ReadyProduct, sets: number, print: ReadyPrintChoice | null): QuoteState | null {
  const [state, setState] = useState<QuoteState | null>(null);
  const body = JSON.stringify({ sets, print });
  useEffect(() => {
    if (!print) return;
    const controller = new AbortController();
    setState((current) => ({ status: 'loading', quote: current?.status === 'ready' ? current.quote : current?.status === 'loading' ? current.quote : null }));
    const timer = setTimeout(() => {
      api.quoteReadyProduct(product.id, JSON.parse(body) as { sets: number; print: ReadyPrintChoice }, controller.signal).then(
        (quote) => setState({ status: 'ready', quote }),
        (err: unknown) => {
          if (!controller.signal.aborted) setState({ status: 'error', message: err instanceof ApiError ? [err.message, ...err.details].join(' ') : t('Could not calculate the price.') });
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `body` stands for the sets and the print choice.
  }, [product.id, body]);
  return print ? state : null;
}

/**
 * Print variant of every plate and the scale of the whole set, for products the shop sliced; each
 * variant shows what one set costs with it at the chosen scale.
 */
function PrintChoice({ options, value, quote, onChange }: {
  options: ReadyPrintOptions;
  value: ReadyPrintChoice;
  quote: ReadyQuote | null;
  onChange: (value: ReadyPrintChoice) => void;
}) {
  const name = useId();
  const percent = Math.round(value.scale * 100);
  const range = { min: Math.ceil(options.scale.min * 100 - 1e-9), max: Math.floor(options.scale.max * 100 + 1e-9) };
  const size = { widthMm: options.size.widthMm * value.scale, depthMm: options.size.depthMm * value.scale, heightMm: options.size.heightMm * value.scale };
  return (
    <div className="ready-print">
      {options.plates.map((plate) => {
        const key = plateKey(plate.plateId);
        return (
          <fieldset key={key} className="option-group">
            <legend>{options.plates.length > 1 ? t('Print quality: {plate}', { plate: plate.name }) : t('Print quality')}</legend>
            <div className="variant-options">
              {plate.variants.map((variant) => {
                const price = quote?.variantPrices?.[key]?.[variant.id];
                const selected = value.variants[key] === variant.id;
                return (
                  <label key={variant.id} className={`variant-option ${selected ? 'is-selected' : ''}`}>
                    <input type="radio" name={`${name}-${key}`} value={variant.id} checked={selected}
                      onChange={() => onChange({ ...value, variants: { ...value.variants, [key]: variant.id } })} />
                    <span className="variant-option__label">{variant.label}</span>
                    <span className="variant-option__facts">
                      {t('{value0} mm nozzle · {value1} mm layers · {value2}', { value0: mm(variant.nozzleMm), value1: mm(variant.layerHeightMm), value2: variant.material })}
                    </span>
                    {price !== undefined && <span className="variant-option__price">{formatPrice(price)}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <div className="field ready-print__scale">
        <span>{t('Size')}</span>
        {range.min < range.max ? (
          <>
            <div className="scale-slider">
              <input type="range" min={range.min} max={range.max} step={1} value={percent} aria-label={t('Size as a percentage of the original')}
                aria-valuetext={`${percent}%, ${formatDimensions(size)}`}
                onChange={(e) => onChange({ ...value, scale: e.target.valueAsNumber / 100 })} />
              <output className="scale-slider__value" aria-hidden="true">{percent}%</output>
            </div>
            <small className="muted">{t('{size} · from {min}% to {max}% of the original', { size: formatDimensions(size), min: range.min, max: range.max })}</small>
          </>
        ) : (
          <small className="muted">{t('{size} (printed at the original size)', { size: formatDimensions(size) })}</small>
        )}
      </div>
    </div>
  );
}

interface Props {
  product: ReadyProduct;
  customer: Customer;
  onCustomerChange: (customer: Customer) => void;
  onClose: () => void;
  onPlaced: (order: Order) => void;
}

/**
 * Ordering a ready-to-print product: the models and their print settings are fixed; the customer picks
 * colors freely at the same price. Choosing another material needs a quote, so the order is sent as
 * a request for one instead of at the shown price.
 */
export function ReadyProductDialog({ product, customer, onCustomerChange, onClose, onPlaced }: Props) {
  const titleId = useId();
  const colorList = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [sets, setSets] = useState(1);
  const [notes, setNotes] = useState('');
  const [choices, setChoices] = useState<FilamentChoice[][]>(() => offeredChoices(product));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { project, printOptions } = product;
  // Sliced products: the customer picks print variants and a scale; materials follow the variants.
  const [print, setPrint] = useState<ReadyPrintChoice | null>(() => (printOptions ? defaultChoice(printOptions) : null));
  const quote = useQuote(product, sets, print);
  const site = MODEL_SOURCE_LABELS[project.source];
  const total = print ? (quote && quote.status !== 'error' ? quote.quote?.total ?? null : null) : totalForSets(product, sets);
  const materialChanged = (item: number, slot: number) => !print && choices[item][slot].material !== product.items[item].settings.filaments[slot].material;
  const needsQuote = choices.some((filaments, item) => filaments.some((_, slot) => materialChanged(item, slot)));

  const setChoice = (item: number, slot: number, patch: Partial<FilamentChoice>) =>
    setChoices(choices.map((filaments, i) => (i !== item ? filaments : filaments.map((f, s) => (s === slot ? { ...f, ...patch } : f)))));
  /** Back to the offered materials, keeping the chosen colors. */
  const restoreMaterials = () => setChoices(choices.map((filaments, i) => filaments.map((f, s) => ({ ...f, material: product.items[i].settings.filaments[s].material }))));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onPlaced(await api.orderReadyProduct(product.id, {
        customer: customerForApi(customer),
        sets,
        notes: notes.trim(),
        items: product.items.map((item, i) => ({
          fileId: item.file?.id ?? null,
          filaments: choices[i].map((filament) => ({ material: filament.material, color: filament.color.trim() })),
        })),
        ...(print && { print }),
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, t('Could not send the order.')));
      setSubmitting(false);
    }
  }

  return (
    <Dialog labelledBy={titleId} onClose={onClose} canClose={!submitting} initialFocus={closeButton} className="project-dialog">
      <header className="dialog__header">
        <div className="project-dialog__project">
          <div className="project-order__thumb">
            {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">◆</span>}
          </div>
          <div>
            <span className={`source-badge source-badge--${project.source}`}>{site}</span>
            <h2 id={titleId}>{t('Order “{title}”', { title: product.title })}</h2>
            {project.author && <p className="muted">{t('Design by {author}', { author: project.author })}</p>}
          </div>
        </div>
        <button ref={closeButton} type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>{t('Close')}</button>
      </header>

      <form onSubmit={(e) => void submit(e)}>
        <section className="project-dialog__section">
          <h3>{t('What we print')}</h3>
          {printOptions && print && <PrintChoice options={printOptions} value={print} quote={quote?.status === 'error' ? null : quote?.quote ?? null} onChange={setPrint} />}
          <p className="muted">
            {print
              ? t('Pick any colors; the print quality decides the material.')
              : t('Pick any colors at the same price. Another material has to be quoted by the shop.')}
          </p>
          <datalist id={colorList}>
            {COLOR_SUGGESTIONS().map((color) => <option key={color} value={color} />)}
          </datalist>
          <ul className="project-models project-items-summary">
            {product.items.map((item, i) => {
              const name = item.file?.name ?? t('The whole project');
              const multi = item.settings.filaments.length > 1;
              return (
                <li key={item.file?.id ?? 'whole'} className="project-model">
                  <div className="project-model__head">
                    {item.file?.thumbnailUrl && <img src={item.file.thumbnailUrl} alt="" referrerPolicy="no-referrer" />}
                    <span className="project-model__name">{name}</span>
                    {item.file && formatFileSize(item.file.sizeBytes) && <span className="muted">{formatFileSize(item.file.sizeBytes)}</span>}
                  </div>
                  <p className="project-items-summary__settings">
                    {t('{quantity} × at {scale}%', { quantity: item.settings.quantity, scale: Math.round(item.settings.scalePercent * (print?.scale ?? 1) * 10) / 10 })}
                  </p>
                  <ol className="ready-dialog__filaments">
                    {choices[i].map((filament, slot) => {
                      const label = multi ? t('{subject}, color {number}', { subject: name, number: slot + 1 }) : name;
                      return (
                        <li key={slot} className={`print-settings__filament${materialChanged(i, slot) ? ' is-changed' : ''}`}>
                          {multi && <span className="print-settings__index" aria-hidden="true">{slot + 1}</span>}
                          {!print && (
                            <select value={filament.material} aria-label={t('Material for {name}', { name: label })}
                              onChange={(e) => setChoice(i, slot, { material: e.target.value as ProjectMaterial })}>
                              {PROJECT_MATERIALS.map((material) => <option key={material} value={material}>{MATERIAL_LABELS[material]()}</option>)}
                            </select>
                          )}
                          <input list={colorList} value={filament.color} maxLength={COLOR_MAX_LENGTH} placeholder={t('Any color')}
                            aria-label={t('Color for {name}', { name: label })} onChange={(e) => setChoice(i, slot, { color: e.target.value })} />
                        </li>
                      );
                    })}
                  </ol>
                </li>
              );
            })}
          </ul>
          {needsQuote && (
            <div className="banner banner--warning" role="status">
              {t('You changed a material, so the shown price no longer applies: we will review the order and email you a quote.')}{' '}
              <button type="button" className="btn btn--small" onClick={restoreMaterials}>{t('Use the offered materials')}</button>
            </div>
          )}
          <div className="ready-dialog__sets">
            <Field label={t('Number of sets')}>
              <input type="number" min={1} max={MAX_QUANTITY} required value={sets}
                onChange={(e) => setSets(Math.min(MAX_QUANTITY, Math.max(1, Math.round(Number(e.target.value)) || 1)))} />
            </Field>
            <p className="ready-dialog__total" aria-live="polite">
              <span>{t('Total')}</span>
              <strong>{needsQuote ? t('Quote needed') : total === null ? '…' : formatPrice(total)}</strong>
              {!needsQuote && sets > 1 && (print ? quote?.status !== 'error' && quote?.quote : product.price) && (() => {
                const price = print && quote?.status !== 'error' && quote?.quote ? quote.quote : product.price;
                return (
                  <small className="muted">
                    {t('{sets} × {setPrice} + handling {handling}', { sets, setPrice: formatPrice(price.setPrice), handling: formatPrice(price.handlingFee) })}
                  </small>
                );
              })()}
              {quote?.status === 'error' && <small className="is-error" role="alert">{quote.message}</small>}
            </p>
          </div>
          <Field label={t('Notes for the workshop')}>
            <textarea rows={2} value={notes} maxLength={2000} placeholder={t('Deadline, gift wrapping…')} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </section>

        <section className="project-dialog__section">
          <h3>{t('Contact and delivery')}</h3>
          <div className="checkout__grid">
            <CustomerFields customer={customer} onChange={(update) => onCustomerChange(update(customer))} />
          </div>
        </section>

        {error && (
          <div className="banner banner--error" role="alert">
            <strong>{error.message}</strong>
            {error.details.length > 0 && <ul>{error.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </div>
        )}
        <p className="muted">
          {needsQuote
            ? t('No payment is taken now — we review every request and email you a quote.')
            : t('The price is fixed when you order. No payment is taken online — the shop will contact you to confirm the order and arrange payment.')}
        </p>
        <footer className="dialog__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>{t('Cancel')}</button>
          <button type="submit" className="btn btn--primary btn--large" disabled={submitting || (!needsQuote && total === null)}>
            {submitting ? t('Sending…') : needsQuote ? t('Request a quote') : total === null ? t('Calculating the price…') : t('Order for {price}', { price: formatPrice(total) })}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
