import { formatNumber, t } from '../../i18n';
import { PRINT_MAX_MM } from '../../config';
import type { CustomOrderFile } from '../../types';
import type { CustomModelAnalysis } from '../../utils/customModel';
import { estimateFile, hasPrintOptions, type Estimate } from '../../utils/printEstimate';
import { formatPrice } from '../../utils/pricing';
import { formatDimensions, formatVolume } from '../../utils/sizing';

const exceedsBuildVolume = ({ analysis }: CustomModelAnalysis) =>
  Math.max(analysis.widthMm, analysis.depthMm, analysis.heightMm) > PRINT_MAX_MM;

const millimeters = (value: number, minimumFractionDigits: number) =>
  `${formatNumber(value, { minimumFractionDigits, maximumFractionDigits: 3 })} mm`;

/** The customer's nozzle, layer height and filament per color part (inline, for rows and the viewer). */
export function PrintChoices({ file }: { file: CustomOrderFile }) {
  if (!hasPrintOptions(file)) {
    return <span className="muted">{t("No print options (requested before they existed)")}</span>;
  }
  return (
    <span className="print-choices">
      <span className="print-choices__setup">
        {t("Nozzle {0} · layers {1}", millimeters(file.nozzle.diameterMm, 1), millimeters(file.layerHeight.heightMm, 2))}
      </span>
      {file.parts.map((part) => (
        <span key={part.key} className="print-choices__part">
          <span className="cart-item__dot" style={{ background: part.color.hex }} aria-hidden="true" />
          {file.parts.length > 1 && `${part.name}: `}{part.filament.name}, {part.color.name}
        </span>
      ))}
    </span>
  );
}

/** Estimated filament and price of one copy from the ordered options and the shop's reading of the file. */
export function fileEstimate(file: CustomOrderFile, result: CustomModelAnalysis): Estimate | null {
  return estimateFile(file, result.analysis.volumeCm3, result.parts);
}

export function EstimateText({ estimate, quantity }: { estimate: Estimate; quantity: number }) {
  return (
    <span className="custom-file__estimate">
      {t("Estimate: {0} g · {1} each", formatNumber(estimate.grams), formatPrice(estimate.unitPrice))}
      {quantity > 1 && <strong> · {t("{0} for {1} copies", formatPrice(Math.round(estimate.unitPrice * quantity * 100) / 100), quantity)}</strong>}
    </span>
  );
}

/**
 * Size, volume and triangle count of a customer's model as measured in the browser: inline text
 * for the request's model list, or a definition list with plates and build-volume fit for the viewer.
 */
export function CustomModelFacts({ result, detailed = false }: { result: CustomModelAnalysis; detailed?: boolean }) {
  const { analysis, plates } = result;
  const tooLarge = exceedsBuildVolume(result);
  if (!detailed) {
    return (
      <>
        <span className="custom-file__facts">
          <span><span className="muted">{t("Size")}</span> {formatDimensions(analysis)}</span>
          <span><span className="muted">{t("Volume")}</span> {formatVolume(analysis.volumeCm3)}</span>
          <span><span className="muted">{t("Triangles")}</span> {formatNumber(analysis.triangleCount)}</span>
          {plates && <span><span className="muted">{t("Plates")}</span> {plates.length}</span>}
        </span>
        {tooLarge && <span className="custom-file__warning">{t("Larger than the {0} mm build volume: scale or split it before printing.", PRINT_MAX_MM)}</span>}
      </>
    );
  }
  return (
    <>
      <dl className="config-details">
        <dt>{t("Size")}</dt>
        <dd>{formatDimensions(analysis)}</dd>
        <dt>{t("Volume")}</dt>
        <dd>{t("{0} per copy", formatVolume(analysis.volumeCm3))}</dd>
        <dt>{t("Triangles")}</dt>
        <dd>{formatNumber(analysis.triangleCount)}</dd>
        {plates && (
          <>
            <dt>{t("Plates")}</dt>
            <dd>{plates.length}</dd>
          </>
        )}
      </dl>
      {tooLarge
        ? <p className="banner banner--warning">{t("Larger than the {0} mm build volume: scale or split it before printing.", PRINT_MAX_MM)}</p>
        : <p className="muted">{t("Fits the {0} mm build volume.", PRINT_MAX_MM)}</p>}
    </>
  );
}
