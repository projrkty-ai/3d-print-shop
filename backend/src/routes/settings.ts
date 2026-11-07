import { Router } from 'express';
import type { AdminAuth } from '../auth';
import type { PricingSettings } from '../domain/types';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';
import { catalogPricing } from '../domain/utils/pricing';
import { pricingSettingsInput } from '../schemas';
import type { Storage } from '../storage';

const cents = (value: number) => Math.round(value * 100) / 100;

/** Shop-wide pricing; only derived catalog rates are public, mutations remain admin-only. */
export function settingsRouter(db: Storage, { requireAdmin }: AdminAuth) {
  const router = Router();

  /** Public derived catalog rates, including when there are no products yet. */
  router.get('/catalog-pricing', async (_req, res) => {
    res.json(catalogPricing((await db.settings.getPricing()) ?? DEFAULT_PRICING));
  });

  /** The saved rates, or the defaults (`updatedAt: null`) until the admin saves them. */
  router.get('/pricing', requireAdmin, async (_req, res) => {
    res.json((await db.settings.getPricing()) ?? DEFAULT_PRICING);
  });

  router.put('/pricing', requireAdmin, async (req, res) => {
    const input = pricingSettingsInput.parse(req.body);
    const settings: PricingSettings = {
      hourlyRate: cents(input.hourlyRate),
      handlingFee: cents(input.handlingFee),
      filamentPricePerKg: Object.fromEntries(Object.entries(input.filamentPricePerKg).map(([material, price]) => [material, cents(price)])) as PricingSettings['filamentPricePerKg'],
      updatedAt: new Date().toISOString(),
    };
    await db.settings.putPricing(settings);
    res.json(settings);
  });

  return router;
}
