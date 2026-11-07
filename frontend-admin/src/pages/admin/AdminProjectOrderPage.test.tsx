// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { PricingSettings, ProjectOrder, ProjectProduct } from '../../types';
import { AdminPricingPage } from './AdminPricingPage';
import { AdminProjectProductsPage } from './AdminProjectProductsPage';
import { AdminProjectProductPage } from './AdminProjectProductPage';
import { AdminProjectOrderPage } from './AdminProjectOrderPage';
import { AdminProjectOrdersPage } from './AdminProjectOrdersPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));
vi.mock('../../store/ProductsContext', () => ({ useProducts: () => ({ reload: async () => undefined }) }));

function projectOrder(patch: Partial<ProjectOrder> = {}): ProjectOrder {
  return {
    id: 'po-1', number: 'PJ-261106-K7QX', status: 'new', adminNote: '', projectVerified: true, requiresQuote: true,
    customer: { name: 'Anna Nowak', email: 'anna@example.com', phone: '+48 600 000 000', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } },
    project: {
      source: 'printables', id: '12345', title: 'Self-watering planter', description: 'Keeps herbs alive.', license: 'CC BY 4.0',
      thumbnailUrl: 'https://media.printables.com/cover.jpg', url: 'https://www.printables.com/model/12345-self-watering-planter', author: 'Prusa',
    },
    items: [
      {
        file: { id: '9', name: 'planter.stl', sizeBytes: 20480, thumbnailUrl: 'https://media.printables.com/9.png' },
        settings: { quantity: 2, scalePercent: 120, filaments: [{ material: 'PETG', color: 'matte black' }, { material: 'TPU', color: '' }] },
      },
      {
        file: { id: '10', name: 'saucer.stl', sizeBytes: 2_097_152, thumbnailUrl: null },
        settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'PLA', color: 'white' }] },
      },
    ],
    sameSettingsForAll: false,
    notes: 'Print the saucer first.',
    createdAt: '2026-11-06T10:00:00.000Z', updatedAt: '2026-11-06T10:00:00.000Z', ...patch,
  };
}

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
const breakdown = () => [...container.querySelectorAll('.project-review .pricing-breakdown tr')].map((row) => row.textContent);

async function openDetails(order: ProjectOrder) {
  vi.spyOn(api, 'getProjectOrder').mockResolvedValue(order);
  vi.spyOn(api, 'getPricing').mockResolvedValue(pricing);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/admin/project-orders/${order.id}`]}>
      <Routes><Route path="/admin/project-orders/:orderId" element={<AdminProjectOrderPage />} /></Routes>
    </MemoryRouter>,
  ));
}

describe('admin project orders', () => {
  it('lists project orders with their project, site, file count and status', async () => {
    vi.spyOn(api, 'listProjectOrders').mockResolvedValue([
      projectOrder(),
      projectOrder({ id: 'po-2', number: 'PJ-2', status: 'quoted', projectVerified: false, items: [{ file: null, settings: projectOrder().items[0].settings }] }),
    ]);
    await act(async () => root.render(<MemoryRouter><AdminProjectOrdersPage /></MemoryRouter>));
    expect(container.querySelector('h1')?.textContent).toBe('Project orders');
    expect(container.textContent).toContain('2 project orders · 1 awaiting review');
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/admin/project-orders/po-1');
    expect(rows[0].textContent).toContain('Self-watering planter');
    expect(rows[0].textContent).toContain('Printables');
    expect(rows[0].querySelectorAll('td')[4].textContent).toBe('2');
    expect(rows[0].querySelectorAll('td')[5].textContent).toBe('3');
    expect(rows[0].querySelector('.status-badge')?.textContent).toBe('New');
    expect(rows[1].textContent).toContain('unverified');
    expect(rows[1].querySelector('.status-badge')?.textContent).toBe('Quoted');
    expect(rows[1].querySelectorAll('td')[4].textContent).toBe('Whole project');
  });

  it('shows the project, chosen files, preferences and customer, and saves a review', async () => {
    await openDetails(projectOrder());
    expect(container.querySelector('h1')?.textContent).toContain('PJ-261106-K7QX');
    expect(container.querySelector('.project-summary__title')?.textContent).toBe('Self-watering planter');
    expect(container.querySelector('.project-summary img')?.getAttribute('src')).toBe('https://media.printables.com/cover.jpg');
    const link = container.querySelector<HTMLAnchorElement>('.project-summary a[target="_blank"]')!;
    expect(link.href).toBe('https://www.printables.com/model/12345-self-watering-planter');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent).toContain('Open on Printables');
    expect(container.textContent).toContain('License: CC BY 4.0');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    const items = [...container.querySelectorAll('.project-item')];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.project-item__file')?.textContent).toBe('planter.stl20 kB');
    expect(items[0].querySelector('.project-preferences')?.textContent).toContain('Quantity2');
    expect(items[0].querySelector('.project-preferences')?.textContent).toContain('Scale120%');
    expect([...items[0].querySelectorAll('.project-filaments li')].map((li) => li.textContent)).toEqual(['PETG · matte black', 'TPU (flexible) · any color']);
    expect(items[1].querySelector('.project-item__file')?.textContent).toBe('saucer.stl2 MB');
    expect([...items[1].querySelectorAll('.project-filaments li')].map((li) => li.textContent)).toEqual(['PLA · white']);
    expect(items[1].textContent).toContain('Material and color');
    expect(container.querySelector('.order-detail__note')?.textContent).toBe('Print the saucer first.');
    expect(container.querySelector('.order-detail__customer')?.textContent).toContain('Anna Nowak');
    expect(container.querySelector('address')?.textContent).toContain('30-001 Kraków');

    const update = vi.spyOn(api, 'updateProjectOrder').mockImplementation(async (_id, changes) => ({ ...projectOrder(), ...changes, updatedAt: '2026-11-07T10:00:00.000Z' }));
    const select = container.querySelector<HTMLSelectElement>('aside select')!;
    expect([...select.options].map((option) => option.value)).toEqual(['new', 'quoted', 'accepted', 'printing', 'shipped', 'cancelled']);
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save changes')!;
    expect(save.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'quoted');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const note = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Quoted $42');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => save.click());
    expect(update).toHaveBeenCalledWith('po-1', { status: 'quoted', adminNote: 'Quoted $42' });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Project order updated.');
    expect(container.querySelector('h1 .status-badge')?.textContent).toBe('Quoted');
  });

  it('shows one selection for all models once', async () => {
    const settings = { quantity: 2, scalePercent: 100, filaments: [{ material: 'PLA' as const, color: 'black' }] };
    await openDetails(projectOrder({ sameSettingsForAll: true, items: projectOrder().items.map((item) => ({ ...item, settings })) }));
    expect(container.textContent).toContain('The customer chose one selection for all models.');
    expect(container.querySelectorAll('.project-item .project-preferences')).toHaveLength(1);
    expect(container.textContent).toContain('Same settings as above for every model.');
  });

  it('warns when the project could not be verified and shows a whole-project order', async () => {
    await openDetails(projectOrder({
      projectVerified: false, notes: '', project: { ...projectOrder().project, license: null, description: '' },
      items: [{ file: null, settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'any', color: '' }] } }],
    }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be fetched from Printables');
    expect(container.querySelector('.project-item__file')?.textContent).toBe('Whole project (the site lists no separate files)');
    expect(container.querySelector('.project-filaments li')?.textContent).toBe('No preference · any color');
    expect(container.textContent).toContain('No notes.');
    expect(container.textContent).not.toContain('License:');
  });

  it('prices the order from the print time and filament per material, and saves the review', async () => {
    await openDetails(projectOrder());
    expect(container.querySelector('.project-review')?.textContent).toContain('Rates: $3.00/h · handling $4.50');
    // Starts with the materials the customer asked for.
    expect([...container.querySelectorAll<HTMLSelectElement>('.project-review__row select')].map((select) => select.value)).toEqual(['PLA', 'PETG', 'TPU']);
    expect(container.textContent).toContain('Enter the print time and the weight of every material to see the price.');
    expect(buttonNamed('Save review').disabled).toBe(true);

    await act(async () => buttonNamed('Remove PLA').click());
    await act(async () => {
      setValue(byLabel('Print time, hours'), '2');
      setValue(byLabel('Print time, minutes'), '30');
      setValue(byLabel('Grams of PETG'), '120');
      setValue(byLabel('Grams of TPU'), '40');
    });
    expect(breakdown()).toEqual([
      'Handling fee$4.50', 'Print time2 h 30 min × $3.00/h$7.50', 'Filament: PETG120 g × $30.00/kg$3.60', 'Filament: TPU (flexible)40 g × $50.00/kg$2.00', 'Total$17.60',
    ]);

    const save = vi.spyOn(api, 'saveProjectReview').mockResolvedValue({ ...projectOrder(), review });
    await act(async () => buttonNamed('Save review').click());
    expect(save).toHaveBeenCalledWith('po-1', { printMinutes: 150, filaments: [{ material: 'PETG', grams: 120 }, { material: 'TPU', grams: 40 }] });
    expect(container.querySelector('.project-review [role="status"]')?.textContent).toBe('Price review saved.');
    expect(container.querySelector('.project-review')?.textContent).toContain('Saved price');
    expect(buttonNamed('Update review').disabled).toBe(true);
  });

  it('shows a saved review, notices changed rates, and creates a ready-to-print product from it', async () => {
    vi.spyOn(api, 'getProjectOrder').mockResolvedValue(projectOrder({ review }));
    vi.spyOn(api, 'getPricing').mockResolvedValue({ ...pricing, hourlyRate: 4 });
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/project-orders/po-1']}>
        <Routes><Route path="/admin/project-orders/:orderId" element={<AdminProjectOrderPage />} /></Routes>
      </MemoryRouter>,
    ));
    expect(byLabel('Print time, hours').value).toBe('2');
    expect(byLabel('Print time, minutes').value).toBe('30');
    expect(byLabel('Grams of PETG').value).toBe('120');
    expect(container.querySelector('.project-review caption')?.textContent).toBe('Price with the current rates');
    expect(container.textContent).toContain('The rates changed since; saving again reprices it.');
    expect(buttonNamed('Update review').disabled).toBe(false);

    const created = { id: 'pp-1', title: 'Planter kit', pricing: { ...review } } as unknown as ProjectProduct;
    const create = vi.spyOn(api, 'createProjectProduct').mockResolvedValue(created);
    const title = [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Title')!.querySelector('input')!;
    expect(title.value).toBe('Self-watering planter');
    await act(async () => setValue(title, ' Planter kit '));
    await act(async () => buttonNamed('Create product').click());
    expect(create).toHaveBeenCalledWith({ orderId: 'po-1', title: 'Planter kit', description: 'Keeps herbs alive.', published: true });
    expect(container.textContent).toContain('Created “Planter kit” for $17.60.');
    expect(container.querySelector('a[href="/admin/ready-to-print/pp-1"]')).not.toBeNull();
  });

  it('locks the price of a fixed-price product order and offers no review', async () => {
    await openDetails(projectOrder({ requiresQuote: false, review, product: { id: 'pp-1', title: 'Planter kit', sets: 2, materialsChanged: false } }));
    expect(container.querySelector('.banner--info')?.textContent).toContain('Ordered from the ready-to-print product Planter kit (2 × $6.55 set price');
    const price = container.querySelector('.project-review')!;
    expect(price.querySelector('h2')?.textContent).toBe('Price');
    expect(price.textContent).toContain('Fixed price: calculated with the shop');
    expect(price.querySelector('tfoot')?.textContent).toBe('Total$17.60');
    expect(price.querySelector('input, select')).toBeNull();
    expect([...container.querySelectorAll('button')].some((b) => /review/i.test(b.textContent!))).toBe(false);
  });

  it('asks for a quote when the customer changed the materials of a product', async () => {
    await openDetails(projectOrder({ requiresQuote: true, product: { id: 'pp-1', title: 'Planter kit', sets: 2, materialsChanged: true } }));
    expect(container.querySelector('.banner--warning')?.textContent).toContain('with other materials than offered, so it needs a quote');
    expect(container.querySelector('.project-review h2')?.textContent).toBe('Price review');
    expect(byLabel('Print time, hours')).not.toBeNull();
  });

  it('cannot create a product before the order is reviewed', async () => {
    await openDetails(projectOrder({ review }));
    expect(container.textContent).toContain('Create product');
    await act(async () => root.unmount());
    root = createRoot(container);
    await openDetails(projectOrder());
    expect(container.textContent).toContain('Save a price review first');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Create product')).toBe(false);
  });

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
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Pricing saved. Ready-to-print prices and new quotes use these rates.');
    await act(async () => setValue(input('Handling fee per order'), '-1'));
    expect(buttonNamed('Save pricing').disabled).toBe(true);
  });

  it('lists ready-to-print products with their price and publishes them', async () => {
    const product = {
      id: 'pp-1', title: 'Planter kit', description: '', published: false, project: projectOrder().project, items: projectOrder().items,
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
      id: 'pp-1', title: 'Planter kit', description: '', published: true, project: projectOrder().project, items: projectOrder().items,
      measurements: { printMinutes: 150, filaments: [{ material: 'PETG' as const, grams: 120 }, { material: 'TPU' as const, grams: 40 }] },
      pricing: review, sourceOrder: { id: 'po-1', number: 'PJ-261106-K7QX' }, createdAt: '2026-11-06T12:00:00.000Z', updatedAt: '2026-11-06T12:00:00.000Z',
    } satisfies ProjectProduct;
    vi.spyOn(api, 'getProjectProduct').mockResolvedValue(product);
    vi.spyOn(api, 'getPricing').mockResolvedValue(pricing);
    const update = vi.spyOn(api, 'updateProjectProduct').mockImplementation(async (_id, changes) => ({ ...product, ...changes, pricing: { ...review, total: 20.6 } }));
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/ready-to-print/pp-1']}>
        <Routes><Route path="/admin/ready-to-print/:productId" element={<AdminProjectProductPage />} /></Routes>
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
});
