import { randomUUID } from 'node:crypto';
import type {
  ExternalProject, PricingSettings, ProjectOrder, ProjectOrderInput, ProjectOrderItem, ProjectProduct, ProjectProductOrderInput,
} from './domain/types';
import { priceProject, pricingForSets } from './domain/utils/projectPricing';
import { HttpError } from './http';
import { t } from './i18n';
import { siteLink } from './modelSearch/normalize';
import type { ModelSearch } from './modelSearch';
import { insertWithNumber, orderNumber } from './orders';
import type { Storage } from './storage';

const SITE_DOMAINS: Record<ExternalProject['source'], string[]> = {
  thingiverse: ['thingiverse.com'],
  printables: ['printables.com'],
  makerworld: ['makerworld.com'],
};

/**
 * Records a request to print an external project. The project is fetched again from its site so the
 * shop sees verified data and file names; if the site is unreachable, the customer's copy is kept and
 * the order is marked unverified. No price is set: the shop quotes after reviewing.
 */
export async function createProjectOrder(db: Storage, modelSearch: ModelSearch, input: ProjectOrderInput): Promise<ProjectOrder> {
  const { source, id } = input.project;
  if (!siteLink(input.project.url, SITE_DOMAINS[source])) throw new HttpError(400, t('invalidRequest'), [t('projectLink')]);
  const resolved = await modelSearch.project({ source, id }).catch(() => null);
  const project: ExternalProject = resolved?.project ?? { ...input.project, description: '', license: null };
  const items: ProjectOrderItem[] = input.items.map(({ file: chosen, settings }) => ({
    file: chosen && (resolved?.files.find((file) => file.id === chosen.id) ?? { id: chosen.id, name: chosen.name, sizeBytes: null, thumbnailUrl: null }),
    settings,
  }));

  const now = new Date();
  const order: ProjectOrder = {
    id: randomUUID(),
    number: '',
    status: 'new',
    customer: input.customer,
    project,
    projectVerified: resolved !== null,
    requiresQuote: true,
    items,
    sameSettingsForAll: input.sameSettingsForAll,
    notes: input.notes,
    adminNote: '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return insertWithNumber((value) => db.projectOrders.insert(value), order, () => orderNumber(now, 'PJ'));
}

/**
 * The customer's materials and colors applied to the product's models. Only colors may differ for the
 * product's price; the result says whether any material changed. Throws for choices that do not match
 * the product's models (wrong model, different number of filaments).
 */
export function applyFilamentChoices(product: ProjectProduct, choices: ProjectProductOrderInput['items']) {
  if (!choices) return { items: product.items, materialsChanged: false };
  if (choices.length !== product.items.length) throw new HttpError(400, t('invalidRequest'), [t('productChoices')]);
  let materialsChanged = false;
  const items = product.items.map((item, index): ProjectOrderItem => {
    const choice = choices[index];
    if ((choice.fileId ?? null) !== (item.file?.id ?? null) || choice.filaments.length !== item.settings.filaments.length) {
      throw new HttpError(400, t('invalidRequest'), [t('productChoices')]);
    }
    const filaments = item.settings.filaments.map((offered, slot) => {
      const chosen = choice.filaments[slot];
      if (chosen.material !== offered.material) materialsChanged = true;
      return { material: chosen.material, color: chosen.color };
    });
    return { ...item, settings: { ...item.settings, filaments } };
  });
  return { items, materialsChanged };
}

/**
 * An order for a ready-to-print product. With the offered materials (any colors) its price is
 * calculated now from the product's measurements and the shop's current rates — `sets` times, the
 * handling fee once — and is final. A changed material makes it an order that needs a quote, with no
 * price until the shop reviews it.
 */
export async function createProductOrder(
  db: Storage, product: ProjectProduct, input: ProjectProductOrderInput, settings: PricingSettings,
): Promise<ProjectOrder> {
  const now = new Date();
  const { sets } = input;
  const { items, materialsChanged } = applyFilamentChoices(product, input.items);
  const order: ProjectOrder = {
    id: randomUUID(),
    number: '',
    status: 'new',
    customer: input.customer,
    project: product.project,
    projectVerified: true,
    requiresQuote: materialsChanged,
    items: items.map((item) => ({ ...item, settings: { ...item.settings, quantity: item.settings.quantity * sets } })),
    sameSettingsForAll: items.every((item) => JSON.stringify(item.settings) === JSON.stringify(items[0].settings)),
    notes: input.notes,
    adminNote: '',
    ...(!materialsChanged && {
      review: { ...pricingForSets(priceProject(product.measurements, settings), sets), reviewedAt: now.toISOString() },
    }),
    product: { id: product.id, title: product.title, sets, materialsChanged },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return insertWithNumber((value) => db.projectOrders.insert(value), order, () => orderNumber(now, 'PJ'));
}
