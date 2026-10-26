import { t } from '../../i18n';
import { useRef, useState, type DragEvent } from 'react';
import { TEXTURE_ACCEPTED_TYPES, TEXTURE_MAX_DIMENSION } from '../../config';
import type { TextureConfig } from '../../types';
import { fileToResizedDataUrl, ImageUploadError } from '../../utils/image';
import { formatPrice } from '../../utils/pricing';

interface Props {
  config: TextureConfig;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  priceScope?: string;
}

export function TextureUpload({ config, value, onChange, priceScope }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await fileToResizedDataUrl(file, TEXTURE_MAX_DIMENSION));
    } catch (err) {
      setError(err instanceof ImageUploadError ? err.message : t("Something went wrong while processing the image."));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files[0]);
  }

  return (
    <fieldset className="option-group">
      <legend>
        {t("Picture texture")} <span className="option-group__price">+{formatPrice(config.price)} {priceScope}</span>
      </legend>
      <p className="option-group__desc">
        {t("Upload a photo or pattern — it is embossed into the surface as a relief in your chosen color.")}
      </p>
      {value ? (
        <div className="texture-current">
          <img src={value} alt={t("Your uploaded texture")} />
          <div className="texture-current__actions">
            <button type="button" className="btn btn--ghost" onClick={() => inputRef.current?.click()}>
              {t("Replace")}
            </button>
            <button type="button" className="btn btn--ghost btn--danger" onClick={() => onChange(null)}>
              {t("Remove")}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        >
          {busy ? t("Processing…") : <>{t("Drop an image here or")} <u>{t("browse")}</u><small>{t("PNG, JPEG or WebP")}</small></>}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={TEXTURE_ACCEPTED_TYPES.join(',')}
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {error && <p className="field__help is-error">{error}</p>}
    </fieldset>
  );
}
