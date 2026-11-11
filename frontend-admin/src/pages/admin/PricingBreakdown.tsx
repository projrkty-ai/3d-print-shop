import { formatNumber, t } from '../../i18n';
import type { ProjectPricing } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { formatDuration } from '../../utils/projectPricing';
import { MATERIAL_LABELS } from './orderDisplay';

export const durationUnits = () => ({ hours: t("h"), minutes: t("min") });

/** handling fee + print time × hourly rate + each material by weight = total, with the rates used. */
export function PricingBreakdown({ pricing, caption }: { pricing: ProjectPricing; caption?: string }) {
  return (
    <table className="pricing-breakdown">
      {caption && <caption>{caption}</caption>}
      <tbody>
        <tr>
          <th scope="row">{t("Handling fee")}</th>
          <td />
          <td>{formatPrice(pricing.handlingFee)}</td>
        </tr>
        <tr>
          <th scope="row">{t("Print time")}</th>
          <td className="muted">{formatDuration(pricing.printMinutes, durationUnits())} × {t("{0}/h", formatPrice(pricing.hourlyRate))}</td>
          <td>{formatPrice(pricing.printTimeCost)}</td>
        </tr>
        {pricing.filaments.map((line) => (
          <tr key={line.material}>
            <th scope="row">{t("Filament: {0}", MATERIAL_LABELS[line.material])}</th>
            <td className="muted">{formatNumber(line.grams, { maximumFractionDigits: 2 })} g × {t("{0}/kg", formatPrice(line.pricePerKg))}</td>
            <td>{formatPrice(line.cost)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t("Total")}</th>
          <td />
          <td>{formatPrice(pricing.total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
