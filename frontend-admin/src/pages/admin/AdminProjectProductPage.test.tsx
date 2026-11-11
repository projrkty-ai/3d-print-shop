// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { ExternalProject, PricingSettings, ProjectOrderItem, ProjectProduct } from '../../types';
import { AdminPricingPage } from './AdminPricingPage';
import { AdminProjectProductsPage } from './AdminProjectProductsPage';
import { AdminProjectProductPage } from './AdminProjectProductPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));
vi.mock('../../store/ProductsContext', () => ({ useProducts: () => ({ reload: async () => undefined }) }));

const project: ExternalProject = {
  source: 'printables', id: '12345', title: 'Self-watering planter', description: 'Keeps herbs alive.', license: 'CC BY 4.0',
  thumbnailUrl: 'https://media.printables.com/cover.jpg', url: 'https://www.printables.com/model/12345-self-watering-planter', author: 'Prusa',
};
const projectItems: ProjectOrderItem[] = [
  {
    file: { id: '9', name: 'planter.stl', sizeBytes: 20480, thumbnailUrl: 'https://media.printables.com/9.png' },
    settings: { quantity: 2, scalePercent: 120, filaments: [{ material: 'PETG', color: 'matte black' }, { material: 'TPU', color: '' }] },
  },
  {
    file: { id: '10', name: 'saucer.stl', sizeBytes: 2_097_152, thumbnailUrl: null },
    settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'PLA', color: 'white' }] },
  },
];

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

const pricing: PricingSettings = {
  hourlyRate: 3, handlingFee: 4.5, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 }, updatedAt: '2026-11-05T10:00:00.000Z',
};
const review = {
  printMinutes: 150, hourlyRate: 3, printTimeCost: 7.5,
  filaments: [{ material: 'PETG' as const, grams: 120, pricePerKg: 30, cost: 3.6 }, { material: 'TPU' as const, grams: 40, pricePerKg: 50, cost: 2 }],
  filamentCost: 5.6, handlingFee: 4.5, total: 17.6, currency: 'USD', reviewedAt: '2026-11-06T12:00:00.000Z',
};

function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
const byLabel = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;

describe('Print on Demand products and pricing', () => {
  it('edits the shop-wide pricing rates', async () => {
    vi.spyOn(api, 'getPricing').mockResolvedValue({ ...pricing, updatedAt: null });
    vi.spyOn(api, 'getPrintSettings').mockRejectedValue(new Error('Unavailable'));
    const saved = { ...pricing, hourlyRate: 2.75 };
    const save = vi.spyOn(api, 'savePricing').mockResolvedValue(saved);
    await act(async () => root.render(<MemoryRouter><AdminPricingPage /></MemoryRouter>));
    expect(container.textContent).toContain('Default rates — save to set your own.');
    const input = (label: string) => [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === label)!.querySelector('input')!;
    await act(async () => {
      setValue(input('Printer hourly rate'), '2.75');
      setValue(input('PETG'), '31.5');
    });
    await act(async () => container.querySelector('form')!.requestSubmit());
    expect(save).toHaveBeenCalledWith({ hourlyRate: 2.75, handlingFee: 4.5, filamentPricePerKg: { ...pricing.filamentPricePerKg, PETG: 31.5 } });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Pricing saved. Print on Demand prices and new quotes use these rates.');
    await act(async () => setValue(input('Handling fee per order'), '-1'));
    expect(buttonNamed('Save pricing').disabled).toBe(true);
  });

  it('lists ready-to-print products with their price and publishes them', async () => {
    const product = {
      id: 'pp-1', title: 'Planter kit', description: '', published: false, project, items: projectItems,
      measurements: { printMinutes: 150, filaments: [{ material: 'PETG', grams: 120 }, { material: 'TPU', grams: 40 }] },
      pricing: review, sourceOrder: { id: 'po-1', number: 'PJ-261106-K7QX' }, createdAt: '2026-11-06T12:00:00.000Z', updatedAt: '2026-11-06T12:00:00.000Z',
    } satisfies ProjectProduct;
    vi.spyOn(api, 'listProjectProducts').mockResolvedValue([product]);
    const update = vi.spyOn(api, 'updateProjectProduct').mockResolvedValue({ ...product, published: true });
    await act(async () => root.render(<MemoryRouter><AdminProjectProductsPage /></MemoryRouter>));
    const row = container.querySelector('tbody tr')!;
    expect(row.textContent).toContain('Planter kit');
    expect(row.textContent).toContain('Printables · from PJ-261106-K7QX');
    expect(row.textContent).toContain('$17.60');
    const toggle = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(update).toHaveBeenCalledWith('pp-1', { published: true });
    expect(container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.checked).toBe(true);
  });

  it('edits a product’s print time and filament, with the price always from the current rates', async () => {
    const product = {
      id: 'pp-1', title: 'Planter kit', description: '', published: true, project, items: projectItems,
      measurements: { printMinutes: 150, filaments: [{ material: 'PETG' as const, grams: 120 }, { material: 'TPU' as const, grams: 40 }] },
      pricing: review, sourceOrder: { id: 'po-1', number: 'PJ-261106-K7QX' }, createdAt: '2026-11-06T12:00:00.000Z', updatedAt: '2026-11-06T12:00:00.000Z',
    } satisfies ProjectProduct;
    vi.spyOn(api, 'getProjectProduct').mockResolvedValue(product);
    vi.spyOn(api, 'getPricing').mockResolvedValue(pricing);
    const update = vi.spyOn(api, 'updateProjectProduct').mockImplementation(async (_id, changes) => ({ ...product, ...changes, pricing: { ...review, total: 20.6 } }));
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/print-on-demand/pp-1']}>
        <Routes><Route path="/admin/print-on-demand/:productId" element={<AdminProjectProductPage />} /></Routes>
      </MemoryRouter>,
    ));
    expect(container.textContent).toContain('Current price for one set');
    expect(byLabel('Print time, hours').value).toBe('2');
    expect(byLabel('Grams of TPU').value).toBe('40');
    const save = buttonNamed('Save print time and filament');
    expect(save.disabled).toBe(true);
    await act(async () => setValue(byLabel('Print time, hours'), '3'));
    expect(container.querySelector('.project-review tfoot')?.textContent).toBe('Total$20.60');
    await act(async () => save.click());
    expect(update).toHaveBeenCalledWith('pp-1', { measurements: { printMinutes: 210, filaments: [{ material: 'PETG', grams: 120 }, { material: 'TPU', grams: 40 }] } });
    expect(container.querySelector('.project-review [role="status"]')?.textContent).toBe('Saved. The shop shows the new price.');
    expect(container.querySelector('aside .pricing-breakdown tfoot')?.textContent).toBe('Total$20.60');
  });

  it('sets up the print file, scaling and print variants of a product, checked before saving', async () => {
    const presets = { printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle' };
    /** Sliced at 50%, 100% and 120%: time ∝ scale², filament ∝ scale³. */
    const variant = (id: string, printMinutes: number, grams: number) => ({
      id, label: `Quality ${id}`, presets, nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA' as const, enabled: true,
      measurements: { printMinutes, filaments: [{ material: 'PLA' as const, grams }] },
      scaled: [0.5, 1.2].map((scale) => ({ scale, measurements: { printMinutes: printMinutes * scale ** 2, filaments: [{ material: 'PLA' as const, grams: grams * scale ** 3 }] } })),
    });
    const plate = (plateId: number, variants: ReturnType<typeof variant>[]) => ({
      plateId, matrix: { printers: [presets.printer], processes: [presets.process], filaments: [presets.filament] },
      support: false, overrides: {}, variants, defaultVariantId: variants[0].id,
    });
    const product = {
      id: 'pp-1', title: 'Planter kit', description: '', published: true, project, items: projectItems,
      measurements: { printMinutes: 150, filaments: [{ material: 'PETG' as const, grams: 120 }] },
      pricing: review, sourceOrder: { id: 'po-1', number: 'PJ-261106-K7QX' }, createdAt: '2026-11-06T12:00:00.000Z', updatedAt: '2026-11-06T12:00:00.000Z',
      mesh: {
        url: '/api/model-files/aaaaaaaaaaaaaaaaaaaaaaaa', format: '3mf' as const, fileName: 'planter.3mf', sizeBytes: 2048, triangleCount: 12, parts: [],
        plates: [{ id: 1, name: 'Pot', objectCount: 1 }, { id: 2, name: 'Saucer', objectCount: 1 }], plate: 1, selectedPlates: [1, 2],
      },
      model: { widthMm: 120, depthMm: 120, heightMm: 150, volumeCm3: 200 },
      scaling: { enabled: true, minScale: 0.5, maxScale: 1.2 },
      slicing: [plate(1, [variant('fine', 120, 100)]), plate(2, [variant('std', 30, 20)])],
    } satisfies ProjectProduct;
    vi.spyOn(api, 'getProjectProduct').mockResolvedValue(product);
    vi.spyOn(api, 'getPricing').mockResolvedValue(pricing);
    const update = vi.spyOn(api, 'updateProjectProduct').mockImplementation(async (_id, changes) => ({ ...product, ...changes }));
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/print-on-demand/pp-1']}>
        <Routes><Route path="/admin/print-on-demand/:productId" element={<AdminProjectProductPage />} /></Routes>
      </MemoryRouter>,
    ));
    expect(container.textContent).toContain('planter.3mf');
    expect(container.textContent).toContain('Not used while print variants are offered');
    // one set with the default variants: 150 min ($7.50) + 120 g of PLA ($2.40) at 100%
    const example = (label: string) => [...container.querySelectorAll('.price-examples tbody tr')].find((row) => row.textContent?.startsWith(label))?.textContent;
    expect(example('Original')).toContain('$9.90');
    // 50%: 37.5 min ($1.88) + 15 g ($0.30)
    expect(example('Smallest')).toContain('$2.18');
    expect(container.textContent).toContain('Variants of Pot');

    // a wider range needs slicing again before saving
    await act(async () => setValue([...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Largest scale (%)'))!.querySelector('input')!, '125'));
    expect(container.textContent).toContain('Some offered print variants are not sliced at 50%, 125% yet');
    await act(async () => buttonNamed('Save print setup').click());
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector('.project-print-setup [role="alert"]')?.textContent).toContain('Pot, Quality fine: not sliced at 125%');
    await act(async () => buttonNamed('Discard changes').click());
    // offering fixed size only needs no other scales
    await act(async () => [...container.querySelectorAll('label')].find((l) => l.textContent === 'Customers can choose the print size')!.querySelector('input')!.click());
    await act(async () => buttonNamed('Save print setup').click());
    expect(update).toHaveBeenCalledWith('pp-1', {
      mesh: product.mesh, model: product.model, slicing: product.slicing, scaling: { enabled: false, minScale: 0.5, maxScale: 1.2 },
    });
    expect(container.querySelector('.project-print-setup [role="status"]')?.textContent).toBe('Print setup saved. The shop shows the new price.');
  });
});
