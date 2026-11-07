// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { PrintSettings } from '../../types';
import { AdminPrintOptionsPage } from './AdminPrintOptionsPage';
import { AdminPricingPage } from './AdminPricingPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));
vi.mock('../../store/ProductsContext', () => ({ useProducts: () => ({ reload: async () => undefined }) }));

const SETTINGS: PrintSettings = {
  nozzles: [
    { id: 'nozzle-0-4', diameterMm: 0.4, priceMultiplier: 1 },
    { id: 'nozzle-0-8', diameterMm: 0.8, priceMultiplier: 0.8 },
  ],
  defaultNozzleId: 'nozzle-0-4',
  layerHeights: [
    { id: 'layer-0-12', heightMm: 0.12, priceMultiplier: 1.5 },
    { id: 'layer-0-2', heightMm: 0.2, priceMultiplier: 1 },
    { id: 'layer-0-48', heightMm: 0.48, priceMultiplier: 0.6 },
  ],
  defaultLayerHeightId: 'layer-0-2',
  filaments: [{
    id: 'pla', name: 'PLA', description: 'Everyday material.', pricePerKg: 80, densityGPerCm3: 1.25,
    colors: [{ id: 'black', name: 'Black', hex: '#1c1c1e' }],
  }],
  updatedAt: '2026-11-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

function type(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

const render = () => act(async () => root.render(<MemoryRouter><AdminPrintOptionsPage /></MemoryRouter>));

const rows = (table: string) => [...container.querySelectorAll<HTMLTableRowElement>(`[data-testid="${table}"] tbody tr`)];

describe('print options editor', () => {
  it('shows both pricing sections and saves their changes independently', async () => {
    const pricing = { hourlyRate: 3, handlingFee: 4, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 }, updatedAt: null };
    vi.spyOn(api, 'getPricing').mockResolvedValue(pricing);
    vi.spyOn(api, 'getPrintSettings').mockResolvedValue(SETTINGS);
    const savePricing = vi.spyOn(api, 'savePricing').mockResolvedValue({ ...pricing, hourlyRate: 5 });
    const saveOptions = vi.spyOn(api, 'updatePrintSettings').mockImplementation(async (body) => ({ ...body, updatedAt: SETTINGS.updatedAt }));
    await act(async () => root.render(<MemoryRouter><AdminPricingPage /></MemoryRouter>));
    expect($('h1')?.textContent).toBe('Pricing');
    expect(container.textContent).toContain('Print options');
    expect(rows('nozzles')).toHaveLength(2);

    const hourlyRate = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Printer hourly rate')!.querySelector('input')!;
    await act(async () => {
      type(hourlyRate, '5');
      type($<HTMLInputElement>('input[aria-label="Price multiplier of layer 0.12 mm"]')!, '1.6');
    });
    await act(async () => container.querySelector('form')!.requestSubmit());
    expect(savePricing).toHaveBeenCalledWith({ hourlyRate: 5, handlingFee: 4, filamentPricePerKg: pricing.filamentPricePerKg });
    expect(saveOptions).not.toHaveBeenCalled();
    expect(button('Save changes').disabled).toBe(false);
    await act(async () => button('Save changes').click());
    expect(saveOptions).toHaveBeenCalledOnce();
    expect(savePricing).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
  });

  it('keeps print options available when pricing fails to load', async () => {
    vi.spyOn(api, 'getPricing').mockRejectedValue(new ApiError(500, 'Pricing unavailable', []));
    vi.spyOn(api, 'getPrintSettings').mockResolvedValue(SETTINGS);
    await act(async () => root.render(<MemoryRouter><AdminPricingPage /></MemoryRouter>));
    expect(container.textContent).toContain('Pricing unavailable');
    expect(rows('nozzles')).toHaveLength(2);
  });

  it('keeps pricing available when print options fail to load', async () => {
    vi.spyOn(api, 'getPricing').mockResolvedValue({
      hourlyRate: 3, handlingFee: 4, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 }, updatedAt: null,
    });
    vi.spyOn(api, 'getPrintSettings').mockRejectedValue(new ApiError(500, 'Print options unavailable', []));
    await act(async () => root.render(<MemoryRouter><AdminPricingPage /></MemoryRouter>));
    expect(container.textContent).toContain('Print options unavailable');
    expect(button('Save pricing')).not.toBeNull();
  });

  it('shows which layer heights each nozzle can print (a quarter to 0.8 × its diameter) and warns about gaps', async () => {
    vi.spyOn(api, 'getPrintSettings').mockResolvedValue(SETTINGS);
    await render();
    expect(rows('nozzles').map((row) => row.querySelector('.print-settings__fit')?.textContent)).toEqual([
      '0.10 mm – 0.32 mm: 0.12 mm, 0.20 mm',
      '0.20 mm – 0.64 mm: 0.20 mm, 0.48 mm',
    ]);
    expect(rows('layers').map((row) => row.querySelector('.print-settings__fit')?.textContent)).toEqual([
      '0.4 mm', '0.4 mm, 0.8 mm', '0.8 mm',
    ]);
    // A 1.2 mm nozzle needs 0.30–0.96 mm layers; only 0.48 mm fits.
    await act(async () => button('+ Add nozzle').click());
    await act(async () => type(rows('nozzles')[2].querySelector<HTMLInputElement>('input[type="number"]')!, '1.2'));
    expect(rows('nozzles')[2].querySelector('.print-settings__fit')?.textContent).toBe('0.30 mm – 0.96 mm: 0.48 mm');
    await act(async () => $<HTMLButtonElement>('button[aria-label="Remove layer height 0.48 mm"]')!.click());
    expect(rows('nozzles')[2].querySelector('.print-settings__warning')?.textContent).toBe('none — add a layer height in this range');
    expect(rows('nozzles')[1].querySelector('.print-settings__fit')?.textContent).toBe('0.20 mm – 0.64 mm: 0.20 mm');
    // The default layer height must suit the default nozzle.
    await act(async () => {
      $<HTMLInputElement>('input[aria-label="Default nozzle: 0.8 mm"]')!.click();
      $<HTMLInputElement>('input[aria-label="Default layer height: 0.12 mm"]')!.click();
    });
    expect($('.banner--warning')?.textContent).toBe("The default layer height doesn't suit the default nozzle. Choose defaults that fit.");
  });

  it('edits nozzles, layer heights, filaments and colors and saves them with readable ids for new entries', async () => {
    vi.spyOn(api, 'getPrintSettings').mockResolvedValue(SETTINGS);
    const save = vi.spyOn(api, 'updatePrintSettings').mockImplementation(async (body) => ({ ...body, updatedAt: '2026-11-02T00:00:00.000Z' }));
    await render();
    expect(button('Save changes').disabled).toBe(true);
    // 100 cm³ × 1.25 g/cm³ = 0.125 kg × $80/kg with the defaults (× 1 × 1).
    expect(container.textContent).toContain('A 100 cm³ model costs ≈ $10.00 in this filament with the defaults (nozzle 0.4 mm, layers 0.20 mm).');

    await act(async () => {
      type($<HTMLInputElement>('input[aria-label="Price multiplier of layer 0.12 mm"]')!, '1.6');
      $<HTMLInputElement>('input[aria-label="Default layer height: 0.12 mm"]')!.click();
    });
    expect(container.textContent).toContain('≈ $16.00 in this filament with the defaults (nozzle 0.4 mm, layers 0.12 mm)');
    await act(async () => button('+ Add layer height').click());
    await act(async () => type(rows('layers')[3].querySelector<HTMLInputElement>('input[type="number"]')!, '0.24'));
    await act(async () => button('+ Add color').click());
    const colorNames = () => [...container.querySelectorAll<HTMLInputElement>('input[aria-label="Color name"]')];
    await act(async () => type(colorNames()[1], 'Signal Red'));
    await act(async () => type($<HTMLInputElement>('input[aria-label="Hex code of Signal Red"]')!, '#cc0000'));

    // New entries need their numbers before they can be saved.
    await act(async () => button('+ Add nozzle').click());
    await act(async () => button('+ Add filament type').click());
    const newFilament = $('article[aria-label="New filament type"]')!;
    await act(async () => type(newFilament.querySelector('input')!, 'PETG'));
    await act(async () => button('Save changes').click());
    expect(save).not.toHaveBeenCalled();
    expect($('[role="alert"]')?.textContent).toBe(
      'The print options have problems.Nozzle #3: enter the diameter.PETG: enter the price per kilogram.',
    );
    await act(async () => type(rows('nozzles')[2].querySelector<HTMLInputElement>('input[type="number"]')!, '0.6'));
    const petg = $('article[aria-label="PETG"]')!;
    await act(async () => type(petg.querySelector<HTMLInputElement>('input[type="number"]')!, '100'));
    await act(async () => button('Save changes').click());

    expect(save).toHaveBeenCalledWith({
      nozzles: [...SETTINGS.nozzles, { id: 'nozzle-0-6', diameterMm: 0.6, priceMultiplier: 1 }],
      defaultNozzleId: 'nozzle-0-4',
      layerHeights: [
        { id: 'layer-0-12', heightMm: 0.12, priceMultiplier: 1.6 },
        SETTINGS.layerHeights[1],
        SETTINGS.layerHeights[2],
        { id: 'layer-0-24', heightMm: 0.24, priceMultiplier: 1 },
      ],
      defaultLayerHeightId: 'layer-0-12',
      filaments: [
        { ...SETTINGS.filaments[0], colors: [...SETTINGS.filaments[0].colors, { id: 'signal-red', name: 'Signal Red', hex: '#cc0000' }] },
        { id: 'petg', name: 'PETG', description: '', pricePerKg: 100, densityGPerCm3: 1.24, colors: [{ id: 'black', name: 'Black', hex: '#1c1c1e' }] },
      ],
    });
    expect($('[role="status"]')?.textContent).toBe('Print options saved. New print requests use them; placed requests keep their prices.');
    expect(button('Save changes').disabled).toBe(true);
  });

  it('shows the problems the server reports and keeps the edits', async () => {
    vi.spyOn(api, 'getPrintSettings').mockResolvedValue(SETTINGS);
    vi.spyOn(api, 'updatePrintSettings').mockRejectedValue(
      new ApiError(400, 'The print options have problems.', ['PLA: add at least one color.']),
    );
    await render();
    await act(async () => $<HTMLButtonElement>('button[aria-label="Remove color Black"]')!.click());
    await act(async () => button('Save changes').click());
    expect($('[role="alert"]')?.textContent).toBe('The print options have problems.PLA: add at least one color.');
    expect(container.querySelectorAll('input[aria-label="Color name"]')).toHaveLength(0);
    await act(async () => button('Discard changes').click());
    expect(container.querySelectorAll('input[aria-label="Color name"]')).toHaveLength(1);
  });
});
