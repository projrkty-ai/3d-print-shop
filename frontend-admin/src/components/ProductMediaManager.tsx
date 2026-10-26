import { t } from '../i18n';
import { useCallback, useEffect, useState } from 'react';
import { resolveAssetUrl } from '../api/urls';
import type { ProductMedia } from '../types';
import { isMediaUrl } from '../utils/productDescription';

export type ManagedMedia = ProductMedia & { id: string } & (
  | { location: 'description'; position: number }
  | { location: 'gallery'; index: number }
  | { location: 'photo' }
);

interface Props {
  items: ManagedMedia[];
  disabled: boolean;
  onUpdate: (item: ManagedMedia, media: ProductMedia) => void;
  onRemove: (item: ManagedMedia) => void;
  onMove: (item: ManagedMedia) => void;
  onReorder: (item: ManagedMedia, direction: -1 | 1) => void;
  onLocate: (item: ManagedMedia) => void;
  onPendingChange: (pending: boolean) => void;
}

function MediaRow({ item, number, disabled, firstGallery, lastGallery, onUpdate, onRemove, onMove, onReorder, onLocate, onDraftChange }: Omit<Props, 'items' | 'onPendingChange'> & {
  item: ManagedMedia; number: number; firstGallery: boolean; lastGallery: boolean;
  onDraftChange: (key: string, pending: boolean) => void;
}) {
  const [url, setUrl] = useState(item.url);
  const [alt, setAlt] = useState(item.alt);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => { setUrl(item.url); setAlt(item.alt); setError(null); setPreviewFailed(false); }, [item.url, item.alt]);
  const pending = url !== item.url || alt !== item.alt;
  const key = item.id;
  useEffect(() => {
    onDraftChange(key, pending);
    return () => onDraftChange(key, false);
  }, [key, pending, onDraftChange]);
  const usage = item.location === 'description' ? t("Description and carousel") : item.location === 'gallery' ? t("Carousel only") : t("Product photo and carousel");
  return (
    <li className="product-media-manager__item">
      <fieldset disabled={disabled} aria-label={t("Media {0}: {1}", number, item.alt || (item.type === 'image' ? t('image') : t('video')))}>
        <legend>{t("Media")} {number} · {item.type === 'image' ? t("Image") : t("Video")}</legend>
        <div className="product-media-manager__preview">
          {item.type === 'image' && !previewFailed
            ? <img src={resolveAssetUrl(item.url)} alt={item.alt} loading="lazy" onError={() => setPreviewFailed(true)} />
            : <span>{previewFailed ? t("Image preview unavailable") : t("Video link")}</span>}
          <div>
            <strong>{item.alt || t("Untitled media")}</strong>
            <p className="muted">{usage}</p>
            <a href={resolveAssetUrl(item.url)} target="_blank" rel="noopener noreferrer">{t("Open")} {item.type === 'image' ? t('image') : t('video')}</a>
          </div>
        </div>
        {item.location === 'photo' ? <p><a href="#product-photo">{t("Edit in Product photo")}</a></p> : (
          <>
            <label className="field">
              <span>{t("Media")} {number} {t("URL")}</span>
              <input type="url" value={url} maxLength={2000} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <label className="field">
              <span>{t("Media")} {number} {t("description / alternative text")}</span>
              <input value={alt} maxLength={500} onChange={(event) => setAlt(event.target.value)} />
            </label>
          </>
        )}
        <div className="description-editor__actions">
          {item.location !== 'photo' && (
            <>
              <button type="button" className="btn btn--small btn--ghost" disabled={!pending} onClick={() => {
                if (!isMediaUrl(url.trim())) { setError(t("Enter a valid HTTP(S) media URL.")); return; }
                setError(null);
                const media = { type: item.type, url: url.trim(), alt: alt.trim() };
                setUrl(media.url);
                setAlt(media.alt);
                onUpdate(item, media);
              }}>{t("Update media")}</button>
              {pending && <button type="button" className="btn btn--small btn--ghost" onClick={() => {
                setUrl(item.url); setAlt(item.alt); setError(null);
              }}>{t("Cancel edits")}</button>}
              <button type="button" className="btn btn--small btn--ghost" onClick={() => onMove(item)}>
                {item.location === 'description' ? t("Move to carousel only") : t("Move into description")}
              </button>
              {item.location === 'description' ? (
                <button type="button" className="btn btn--small btn--ghost" onClick={() => onLocate(item)}>{t("Select in description")}</button>
              ) : (
                <>
                  <button type="button" className="btn btn--small btn--ghost" disabled={firstGallery} onClick={() => onReorder(item, -1)}>{t("Move earlier")}</button>
                  <button type="button" className="btn btn--small btn--ghost" disabled={lastGallery} onClick={() => onReorder(item, 1)}>{t("Move later")}</button>
                </>
              )}
            </>
          )}
          <button type="button" className="btn btn--small btn--ghost btn--danger" aria-label={t("Remove media {0}", number)}
            onClick={() => onRemove(item)}>{t("Remove")}</button>
        </div>
        {error && <p className="banner banner--error" role="alert">{error}</p>}
      </fieldset>
    </li>
  );
}

export function ProductMediaManager({ items, onPendingChange, ...actions }: Props) {
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const onDraftChange = useCallback((key: string, pending: boolean) => {
    setPendingKeys((previous) => {
      if (previous.has(key) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => onPendingChange(pendingKeys.size > 0), [pendingKeys, onPendingChange]);
  const gallery = items.filter((item) => item.location === 'gallery');
  return (
    <section className="product-media-manager" aria-label={t("Product media manager")}>
      <h4>{t("Product media (")}{items.length})</h4>
      <p className="muted">{t("All description media, carousel-only entries and the product photo. Apply URL or label edits with Update media, then Save product. Removing an item changes this product, not the stored file.")}</p>
      {pendingKeys.size > 0 && <p className="banner banner--warning" role="status">{t("Apply or cancel pending media edits before saving the product.")}</p>}
      {items.length === 0 ? <p>{t("No media added yet.")}</p> : (
        <ul>
          {items.map((item, index) => (
            <MediaRow key={item.id} {...actions} onDraftChange={onDraftChange} item={item} number={index + 1}
              firstGallery={item === gallery[0]} lastGallery={item === gallery.at(-1)} />
          ))}
        </ul>
      )}
    </section>
  );
}
