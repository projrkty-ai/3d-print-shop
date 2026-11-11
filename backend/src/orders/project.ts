import type {
  ExternalProject, ItemReview, OrderInput, OrderItem, PricingSettings, PrintMaterial, PrintOnDemandChoices, PrintOnDemandModel, ProjectModel,
  ProjectOrderItem, ProjectProduct,
} from '../domain/types';
import { filamentSlots, priceMeasurements, roundCents } from '../domain/orderPricing';
import { printMeasurements, printSummary, projectUsesVariants, resolvePrintChoice } from '../domain/utils/projectPrint';
import { HttpError } from '../http';
import { t } from '../i18n';
import { siteLink } from '../modelSearch/normalize';
import type { ModelSearch } from '../modelSearch';
import type { SourceDraft } from './types';

type ProjectInput = Extract<OrderInput, { source: 'project' }>;

const SITE_DOMAINS: Record<ExternalProject['source'], string[]> = {
  thingiverse: ['thingiverse.com'],
  printables: ['printables.com'],
  makerworld: ['makerworld.com'],
};

/**
 * Models of an external project. The project is fetched again from its site so the shop sees
 * verified data and file names; if the site is unreachable, the customer's copy is kept and the
 * order is marked unverified. The order needs a quote.
 */
export async function projectDraft(modelSearch: ModelSearch, input: ProjectInput, handlingFee: number): Promise<SourceDraft> {
  const { source, id } = input.project;
  if (!siteLink(input.project.url, SITE_DOMAINS[source])) throw new HttpError(400, t('invalidRequest'), [t('projectLink')]);
  const resolved = await modelSearch.project({ source, id }).catch(() => null);
  const project: ExternalProject = resolved?.project ?? { ...input.project, description: '', license: null };
  const items = input.items.map(({ file: chosen, settings }): OrderItem<ProjectModel> => ({
    model: {
      source: 'project',
      file: chosen && (resolved?.files.find((file) => file.id === chosen.id) ?? { id: chosen.id, name: chosen.name, sizeBytes: null, thumbnailUrl: null }),
      scalePercent: settings.scalePercent,
      filaments: settings.filaments,
    },
    quantity: settings.quantity,
    unitPrice: null,
    lineTotal: null,
  }));
  return {
    source: 'project',
    items,
    project: { ...project, verified: resolved !== null, sameSettingsForAll: input.sameSettingsForAll },
    price: { mode: 'quote', handlingFee, estimated: null, reviewed: null, total: null },
  };
}

/**
 * The customer's materials and colors applied to the product's models. Only colors may differ for the
 * product's price; the result says whether any material changed. Throws for choices that do not match
 * the product's models (wrong model, different number of filaments).
 */
export function applyFilamentChoices(product: ProjectProduct, choices: PrintOnDemandChoices['items']) {
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
 * The customer's colors applied to the product's models (sliced products). Materials come from the
 * chosen print variants: when they all print one material, every model is in it; otherwise the
 * models keep the offered materials and the order's print variants tell the workshop.
 */
function applyColors(product: ProjectProduct, choices: PrintOnDemandChoices['items'], variantMaterials: PrintMaterial[]): ProjectOrderItem[] {
  const { items } = applyFilamentChoices(product, choices);
  const single = new Set(variantMaterials).size === 1 ? variantMaterials[0] : null;
  return items.map((item, index) => ({
    ...item,
    settings: {
      ...item.settings,
      filaments: item.settings.filaments.map((filament, slot) => ({
        ...filament, material: single ?? product.items[index].settings.filaments[slot].material,
      })),
    },
  }));
}

/**
 * Sets of a Print on Demand product: one item, the product's models with the customer's colors,
 * `sets` copies. With the offered materials its price is calculated now with the shop's current
 * rates and is final: from the chosen print variants at the chosen scale for sliced products, else
 * from the product's measurements, which also become the item's measurements. A changed material
 * (products without variants) makes it an order that needs a quote.
 */
export function printOnDemandDraft(product: ProjectProduct, choices: PrintOnDemandChoices, settings: PricingSettings, now = new Date()): SourceDraft {
  const sliced = projectUsesVariants(product);
  const print = sliced ? resolvePrintChoice(product, choices.print) : undefined;
  if (typeof print === 'string') throw new HttpError(400, t('invalidRequest'), [print]);
  const chosen = applyFilamentChoices(product, choices.items);
  // Sliced products print the materials of the chosen variants; only colors are the customer's.
  const materialsChanged = sliced ? false : chosen.materialsChanged;
  const models = print ? applyColors(product, choices.items, print.plates.map(({ variant }) => variant.material)) : chosen.items;
  const scale = print?.scale ?? 1;
  const model: PrintOnDemandModel = {
    source: 'printOnDemand',
    productId: product.id,
    title: product.title,
    models: models.map((item) => ({ ...item, settings: { ...item.settings, scalePercent: Math.round(item.settings.scalePercent * scale * 10) / 10 } })),
    ...(print && { print: printSummary(product, print) }),
    materialsChanged,
  };
  const measurements = print ? printMeasurements(print) : product.measurements;
  const priced = priceMeasurements(
    { printMinutes: measurements.printMinutes, filaments: measurements.filaments.map(({ material, grams }) => ({ key: material, grams })) },
    filamentSlots(model, settings), settings.hourlyRate,
  );
  if (typeof priced === 'string') throw new HttpError(400, t('invalidRequest'), [priced]);
  const review: ItemReview = { ...priced, reviewedAt: now.toISOString() };
  const sets = choices.sets;
  const fixed = !materialsChanged;
  const item: OrderItem<PrintOnDemandModel> = {
    model,
    quantity: sets,
    unitPrice: fixed ? review.unitPrice : null,
    lineTotal: fixed ? roundCents(review.unitPrice * sets) : null,
    // The product's measurements are the shop's: with other materials they need measuring again.
    ...(fixed && { review }),
  };
  const total = roundCents(settings.handlingFee + review.unitPrice * sets);
  return {
    source: 'printOnDemand',
    items: [item],
    project: { ...product.project, verified: true, sameSettingsForAll: models.every((m) => JSON.stringify(m.settings) === JSON.stringify(models[0].settings)) },
    price: {
      mode: fixed ? 'fixed' : 'quote',
      handlingFee: settings.handlingFee,
      estimated: null,
      reviewed: fixed ? total : null,
      total: fixed ? total : null,
    },
  };
}
