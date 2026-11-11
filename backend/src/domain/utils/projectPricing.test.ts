import { describe, expect, it } from 'vitest';
import type { PricingSettings } from '../types';
import { DEFAULT_PRICING, priceProject, pricingForSets, setPrice } from './projectPricing';

const settings: PricingSettings = {
  hourlyRate: 3.5, handlingFee: 6, filamentPricePerKg: { ...DEFAULT_PRICING.filamentPricePerKg, PLA: 24, TPU: 45 }, updatedAt: null,
};

describe('project pricing', () => {
  it('adds the handling fee, print time at the hourly rate and every material by weight', () => {
    const pricing = priceProject({ printMinutes: 150, filaments: [{ material: 'PLA', grams: 120 }, { material: 'TPU', grams: 35 }, { material: 'PLA', grams: 30 }] }, settings);
    expect(pricing).toEqual({
      printMinutes: 150,
      hourlyRate: 3.5,
      printTimeCost: 8.75,
      filaments: [
        { material: 'PLA', grams: 150, pricePerKg: 24, cost: 3.6 },
        { material: 'TPU', grams: 35, pricePerKg: 45, cost: 1.58 },
      ],
      filamentCost: 5.18,
      handlingFee: 6,
      total: 19.93,
      currency: 'USD',
    });
    expect(setPrice(pricing)).toBe(13.93);
  });

  it('rounds every part to cents and keeps the total equal to their sum', () => {
    const pricing = priceProject({ printMinutes: 7, filaments: [{ material: 'PETG', grams: 0.4 }] }, { ...settings, hourlyRate: 1.99 });
    expect(pricing.printTimeCost).toBe(0.23);
    expect(pricing.filaments[0].cost).toBe(0.01);
    expect(pricing.total).toBe(6.24);
  });

  it('repeats everything but the handling fee for several sets', () => {
    const one = priceProject({ printMinutes: 150, filaments: [{ material: 'PLA', grams: 150 }, { material: 'TPU', grams: 35 }] }, settings);
    const three = pricingForSets(one, 3);
    expect(three).toMatchObject({ printMinutes: 450, printTimeCost: 26.25, filamentCost: 15.54, handlingFee: 6, total: 47.79 });
    expect(three.filaments).toEqual([
      { material: 'PLA', grams: 450, pricePerKg: 24, cost: 10.8 },
      { material: 'TPU', grams: 105, pricePerKg: 45, cost: 4.74 },
    ]);
    expect(three.total).toBe(Math.round((one.handlingFee + 3 * setPrice(one)) * 100) / 100);
    expect(pricingForSets(one, 1)).toEqual(one);
  });
});
