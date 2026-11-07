import { t } from '../i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { CUSTOM_MODEL_COLOR, PRINT_MAX_MM } from '../config';
import type { PrintSettings } from '../types';
import type { CustomModelInfo } from '../utils/customModel';
import { formatBytes } from '../utils/format';
import { formatPrice } from '../utils/pricing';
import { chosenColors, type Estimate, type ModelOptions } from '../utils/printOptions';
import { formatDimensions, formatVolume } from '../utils/sizing';
import { LazyProductPreview } from './LazyProductPreview';
import { PrintOptionsSummary } from './PrintOptions';

interface Props {
  file: File;
  info: CustomModelInfo;
  quantity: number;
  /** The shop's offer and the customer's choices; the model is shown in the chosen filament colors. */
  settings: PrintSettings | null;
  options: ModelOptions | null;
  estimate: Estimate | null;
  onClose: () => void;
}

/**
 * The customer's own model in an interactive 3D preview, read straight from their computer:
 * nothing is uploaded before the request is confirmed.
 */
export function ModelPreviewDialog({ file, info, quantity, settings, options, estimate, onClose }: Props) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    // Focus returns to the model that opened the preview when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  const tooLarge = Math.max(info.widthMm, info.depthMm, info.heightMm) > PRINT_MAX_MM;
  const colors = settings && options ? chosenColors(info.parts, options, settings) : undefined;

  return (
    <div className="model-dialog__backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="model-dialog card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="model-dialog__header">
          <h2 id={titleId}>{file.name}</h2>
          <button ref={closeButton} type="button" className="btn btn--ghost" onClick={onClose}>{t("Close")}</button>
        </div>
        <div className="model-dialog__layout">
          {url ? (
            <LazyProductPreview
              shape="box"
              meshUrl={url}
              meshPlates={info.plates}
              color={colors?.color ?? CUSTOM_MODEL_COLOR}
              partColors={colors?.partColors}
              scale={[1, 1, 1]}
              engravingText=""
              engravingFont="Arial"
              textureUrl={null}
              caption={formatDimensions(info)}
              className="model-dialog__preview"
            />
          ) : (
            <div className="preview preview--loading model-dialog__preview">{t("Loading 3D preview…")}</div>
          )}
          <div className="model-dialog__details">
            <dl className="config-details">
              <dt>{t("Format")}</dt>
              <dd>{info.format.toUpperCase()} · {formatBytes(file.size)}</dd>
              <dt>{t("Size")}</dt>
              <dd>{formatDimensions(info)}</dd>
              <dt>{t("Volume")}</dt>
              <dd>{formatVolume(info.volumeCm3)}</dd>
              {info.plateCount > 1 && (
                <>
                  <dt>{t("Plates")}</dt>
                  <dd>{info.plateCount}</dd>
                </>
              )}
              <dt>{t("Copies")}</dt>
              <dd>{quantity}</dd>
              {settings && options && (
                <>
                  <dt>{t("Print options")}</dt>
                  <dd><PrintOptionsSummary parts={info.parts} options={options} settings={settings} /></dd>
                </>
              )}
              {estimate && (
                <>
                  <dt>{t("Estimated price")}</dt>
                  <dd>{t("≈ {value0} each", { value0: formatPrice(estimate.unitPrice) })}</dd>
                </>
              )}
            </dl>
            {tooLarge && (
              <p className="banner banner--warning">
                {t("Larger than our {value0} mm build volume — we'll suggest scaling or splitting it.", { value0: PRINT_MAX_MM })}
              </p>
            )}
            <p className="muted">{t("This preview is only on your device; the file is sent when you confirm the order.")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
