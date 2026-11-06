import { t } from '../../i18n';
import { useRef, useState, type DragEvent } from 'react';
import { resolveAssetUrl } from '../../api/urls';
import { TEXTURE_ACCEPTED_TYPES, TEXTURE_MAX_DIMENSION } from '../../config';
import type { SurfaceCustomization, TextureConfig } from '../../types';
import { fileToResizedDataUrl, ImageUploadError } from '../../utils/image';
import { formatPrice } from '../../utils/pricing';

type TextureChoice = Pick<SurfaceCustomization, 'textureDataUrl' | 'textureId'>;

interface Props {
  config: TextureConfig;
  value: TextureChoice;
  onChange: (choice: TextureChoice) => void;
  priceScope?: string;
  /** Radio group name; must be unique when several pickers are on one page. */
  name?: string;
}

const NONE = 'none';
const CUSTOM = 'custom';

/**
 * Picture texture: one of the shop's textures or the customer's own picture.
 * Products without shop textures show only the upload, exactly as before the texture library.
 */
export function TexturePicker({ config, value, onChange, priceScope, name = 'texture' }: Props) {
  const options = config.options ?? [];
  const allowCustom = config.allowCustom !== false;
  // Keeps "Your picture" selected while the customer looks for a file.
  const [pickingCustom, setPickingCustom] = useState(false);
  // The last uploaded picture comes back when switching away to a shop texture and back again.
  const [lastPicture, setLastPicture] = useState(value.textureDataUrl);
  if (!config.enabled || (options.length === 0 && !allowCustom)) return null;

  const selectedOption = options.find((option) => option.id === value.textureId);
  const mode = selectedOption ? selectedOption.id : value.textureDataUrl || pickingCustom ? CUSTOM : NONE;
  const selectedName = selectedOption?.name ?? (mode === CUSTOM ? t("Your picture") : undefined);

  function select(next: string) {
    setPickingCustom(next === CUSTOM);
    if (next === NONE) onChange({ textureId: null, textureDataUrl: null });
    else if (next === CUSTOM) onChange({ textureId: null, textureDataUrl: lastPicture });
    else onChange({ textureId: next, textureDataUrl: null });
  }

  function changePicture(dataUrl: string | null) {
    setLastPicture(dataUrl);
    onChange({ textureId: null, textureDataUrl: dataUrl });
  }

  const upload = <PictureUpload value={value.textureDataUrl} onChange={changePicture} />;
  return (
    <fieldset className="option-group">
      <legend>
        {t("Picture texture")}
        {options.length > 0 && selectedName && <span className="option-group__current">: {selectedName}</span>}{' '}
        <span className="option-group__price">+{formatPrice(config.price)} {priceScope}</span>
      </legend>
      {options.length === 0 ? (
        <>
          <p className="option-group__desc">
            {t("Upload a photo or pattern — it is embossed into the surface as a relief in your chosen color.")}
          </p>
          {upload}
        </>
      ) : (
        <>
          <p className="option-group__desc">
            {allowCustom
              ? t("Choose one of our textures or upload your own picture — it is embossed into the surface as a relief in your chosen color.")
              : t("Choose one of our textures — it is embossed into the surface as a relief in your chosen color.")}
          </p>
          <div className="texture-options">
            <label className={`texture-option ${mode === NONE ? 'is-selected' : ''}`}>
              <input type="radio" name={name} checked={mode === NONE} onChange={() => select(NONE)} />
              <span className="texture-option__image texture-option__image--empty" aria-hidden="true" />
              <span className="texture-option__name">{t("No texture")}</span>
            </label>
            {options.map((option) => (
              <label key={option.id} className={`texture-option ${mode === option.id ? 'is-selected' : ''}`}>
                <input type="radio" name={name} value={option.id} checked={mode === option.id} onChange={() => select(option.id)} />
                <img className="texture-option__image" src={resolveAssetUrl(option.url)} alt="" loading="lazy" />
                <span className="texture-option__name">{option.name}</span>
              </label>
            ))}
            {allowCustom && (
              <label className={`texture-option ${mode === CUSTOM ? 'is-selected' : ''}`}>
                <input type="radio" name={name} checked={mode === CUSTOM} onChange={() => select(CUSTOM)} />
                {lastPicture
                  ? <img className="texture-option__image" src={lastPicture} alt="" />
                  : <span className="texture-option__image texture-option__image--upload" aria-hidden="true">+</span>}
                <span className="texture-option__name">{t("Your picture")}</span>
              </label>
            )}
          </div>
          {mode === CUSTOM && upload}
        </>
      )}
    </fieldset>
  );
}

/** Drop zone / file picker for the customer's own picture, downscaled in the browser. */
function PictureUpload({ value, onChange }: { value: string | null; onChange: (dataUrl: string | null) => void }) {
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
    <>
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
    </>
  );
}
