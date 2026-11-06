import { t } from '../../i18n';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { resolveAssetUrl } from '../../api/urls';
import { TEXTURE_ACCEPTED_TYPES } from '../../config';
import type { TextureOption } from '../../types';
import { createId } from '../../utils/ids';

/** The API's image upload limit (media files). */
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  options: TextureOption[];
  onAdd: (option: TextureOption) => void;
  onChange: (id: string, patch: Partial<TextureOption>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onBusyChange: (busy: boolean) => void;
}

/** "oak-wood_grain.png" → "oak wood grain": a starting name the admin can edit. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || t("Texture");
}

/**
 * Shop textures customers can pick instead of uploading their own picture. Images are stored
 * at full resolution when uploaded (for printing), like description images, and kept when removed here.
 */
export function TextureLibraryEditor({ options, onAdd, onChange, onRemove, onMove, onBusyChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    const invalid = files.find((file) => !TEXTURE_ACCEPTED_TYPES.includes(file.type) || file.size > MAX_BYTES);
    if (invalid) {
      setError(t("{0}: choose a PNG, JPEG or WebP image up to 10 MB.", invalid.name));
      return;
    }
    setError(null);
    setUploading(true);
    onBusyChange(true);
    try {
      // One at a time, so textures appear in the order they were selected.
      for (const file of files) {
        const { url } = await api.uploadTextureImage(file);
        onAdd({ id: createId('texture'), name: nameFromFile(file.name), url });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Could not upload the texture."));
    } finally {
      setUploading(false);
      onBusyChange(false);
    }
  }

  return (
    <section className="texture-library" aria-label={t("Shop textures")}>
      <h3>{t("Shop textures")}</h3>
      <p className="muted">
        {t("Customers can pick one of these instead of uploading a picture. Images are stored at full resolution as soon as they are uploaded, and kept when removed here.")}
      </p>
      {options.length === 0 ? (
        <p className="muted">{t("No shop textures yet.")}</p>
      ) : (
        <ul className="texture-library__list">
          {options.map((option, index) => (
            <li key={option.id} className="texture-library__item">
              <a href={resolveAssetUrl(option.url)} target="_blank" rel="noopener noreferrer" title={t("Open the original image")}>
                <img src={resolveAssetUrl(option.url)} alt={option.name} loading="lazy" />
              </a>
              <label className="field">
                <span>{t("Texture {0} name", index + 1)}</span>
                <input value={option.name} maxLength={80} onChange={(event) => onChange(option.id, { name: event.target.value })} />
              </label>
              <div className="texture-library__actions">
                <button type="button" className="btn btn--small btn--ghost" disabled={index === 0}
                  aria-label={t("Move texture {0} earlier", option.name || index + 1)} onClick={() => onMove(option.id, -1)}>↑</button>
                <button type="button" className="btn btn--small btn--ghost" disabled={index === options.length - 1}
                  aria-label={t("Move texture {0} later", option.name || index + 1)} onClick={() => onMove(option.id, 1)}>↓</button>
                <button type="button" className="icon-btn" aria-label={t("Remove texture {0}", option.name || index + 1)}
                  onClick={() => onRemove(option.id)}>×</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <label className="btn btn--small">
        {uploading ? t("Uploading…") : t("+ Upload textures")}
        <input
          type="file"
          accept={TEXTURE_ACCEPTED_TYPES.join(',')}
          multiple
          hidden
          disabled={uploading}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void upload(files);
          }}
        />
      </label>
      <small className="field__help">{t("PNG, JPEG or WebP, up to 10 MB each.")}</small>
      {error && <p className="banner banner--error" role="alert">{error}</p>}
    </section>
  );
}
