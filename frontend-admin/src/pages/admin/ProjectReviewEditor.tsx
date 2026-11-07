import { t } from '../../i18n';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { PRINT_MATERIALS, type PricingSettings, type ProjectOrder } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { MeasurementsForm } from './MeasurementsForm';
import { PricingBreakdown } from './PricingBreakdown';
import { formatDateTime } from './orderDisplay';

interface Props {
  order: ProjectOrder;
  pricing: PricingSettings;
  onSaved: (order: ProjectOrder) => void;
}

/**
 * The order's price. Orders that need a quote are priced here from the measured print time and
 * filament (and can be repriced); fixed-price orders show the price they were placed with, locked.
 */
export function ProjectReviewEditor({ order, pricing, onSaved }: Props) {
  if (!order.requiresQuote) {
    return (
      <section className="card project-review" aria-labelledby="project-review-title">
        <h2 id="project-review-title">{t("Price")}</h2>
        <p className="muted">{t("Fixed price: calculated with the shop's rates when the customer ordered. It cannot change.")}</p>
        {order.review ? (
          <>
            <PricingBreakdown pricing={order.review} />
            <p className="muted">{t("Priced {0}.", formatDateTime(order.review.reviewedAt))}</p>
          </>
        ) : (
          <p className="muted">{t("No price was recorded for this order.")}</p>
        )}
      </section>
    );
  }

  const wished = new Set(order.items.flatMap((item) => item.settings.filaments.map((filament) => filament.material)));
  return (
    <section className="card project-review" aria-labelledby="project-review-title">
      <h2 id="project-review-title">{t("Price review")}</h2>
      <p className="muted">
        {t("This order needs a quote. Enter the total print time and the filament used per material for the whole order, e.g. from the slicer.")}
        {' '}<Link to="/admin/pricing">{t("Rates")}</Link>: {t("{0}/h", formatPrice(pricing.hourlyRate))} · {t("handling {0}", formatPrice(pricing.handlingFee))}
      </p>
      <MeasurementsForm
        initial={order.review ? { printMinutes: order.review.printMinutes, filaments: order.review.filaments.map(({ material, grams }) => ({ material, grams })) } : null}
        suggestedMaterials={PRINT_MATERIALS.filter((material) => wished.has(material))}
        pricing={pricing}
        saved={order.review && { pricing: order.review, at: order.review.reviewedAt }}
        saveLabel={order.review ? t("Update review") : t("Save review")}
        successText={t("Price review saved.")}
        onSave={async (measurements) => onSaved(await api.saveProjectReview(order.id, measurements))}
      />
    </section>
  );
}
