import { t } from '../../i18n';
import { useEffect, useId, useRef } from 'react';
import { LazyProductPreview } from '../../components/LazyProductPreview';
import type { CustomOrderFile } from '../../types';
import { formatDimensions } from '../../utils/sizing';
import { fileColors } from '../../utils/printEstimate';
import { CustomModelFacts, EstimateText, fileEstimate, PrintChoices } from './CustomModelFacts';
import { formatBytes } from './customOrderDisplay';
import type { CustomerModel } from './useCustomerModels';

/** Neutral filament color: customer files carry no color choice of the shop. */
const MODEL_COLOR = '#9aa6b8';

interface Props {
  file: CustomOrderFile;
  model: CustomerModel;
  orderNumber: string;
  /** 1-based position of the file in the request. */
  position: number;
  onDownload: () => void;
  onClose: () => void;
}

/** A customer's model in 3D with what the shop needs to review it: size, volume, plates and build-volume fit. */
export function CustomModelViewer({ file, model, orderNumber, position, onDownload, onClose }: Props) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus returns to whatever opened the viewer (the model row) when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  const analysis = model.status === 'ready' ? model.result.analysis : null;
  const colors = fileColors(file);
  const estimate = model.status === 'ready' ? fileEstimate(file, model.result) : null;

  return (
    <div className="viewer-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="viewer card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="viewer__header">
          <div>
            <h2 id={titleId} className="custom-file__name">{file.fileName}</h2>
            <p className="muted">{t("Print request {0}, file {1}", orderNumber, position)}</p>
          </div>
          <button ref={closeButton} type="button" className="btn btn--ghost" onClick={onClose}>{t("Close")}</button>
        </div>
        <div className="viewer__layout">
          <div className="viewer__models">
            {model.status === 'ready' && (
              <figure className="viewer__model">
                <LazyProductPreview
                  shape="box"
                  meshUrl={model.url}
                  meshPlates={model.result.plates}
                  color={colors?.color ?? MODEL_COLOR}
                  partColors={colors?.partColors}
                  scale={[1, 1, 1]}
                  engravingText=""
                  engravingFont="Arial"
                  textureUrl={null}
                  caption={analysis ? formatDimensions(analysis) : undefined}
                />
              </figure>
            )}
            {model.status === 'loading' && <div className="preview preview--loading" role="status">{t("Loading 3D model…")}</div>}
            {model.status === 'error' && <p className="banner banner--error" role="alert">{model.message}</p>}
          </div>
          <div className="viewer__details">
            <h3>{t("Model details")}</h3>
            <dl className="config-details">
              <dt>{t("Format")}</dt>
              <dd>{file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}</dd>
              <dt>{t("Copies")}</dt>
              <dd>{file.quantity}</dd>
              <dt>{t("Print options")}</dt>
              <dd><PrintChoices file={file} /></dd>
              {estimate && (
                <>
                  <dt>{t("Estimate")}</dt>
                  <dd><EstimateText estimate={estimate} quantity={file.quantity} /></dd>
                </>
              )}
            </dl>
            {model.status === 'ready' && <CustomModelFacts result={model.result} detailed />}
            <p className="muted">{t("Volume assumes a closed, watertight mesh. STL files have no units; millimeters are assumed.")}</p>
            <button type="button" className="btn" onClick={onDownload}>{t("Download")}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
