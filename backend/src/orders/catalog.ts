import type { CatalogModel, OrderInput, OrderItem, Product } from '../domain/types';
import { normalizeCustomization, normalizeCustomizationText } from '../domain/utils/customization';
import { summarizeConfiguration } from '../domain/utils/orderLines';
import { calculatePrice, catalogPricing } from '../domain/utils/pricing';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';
import { productDimensionsError } from '../domain/utils/scaling';
import { customizationEngravingErrors, customizationExtrudedTextErrors, customizationTextureErrors } from '../domain/utils/validation';
import { roundCents } from '../domain/orderPricing';
import { HttpError } from '../http';
import { t } from '../i18n';
import type { Storage } from '../storage';
import type { SourceDraft } from './types';

type CatalogInput = Extract<OrderInput, { items: { productId: string }[] }>['items'];

/**
 * Turns checkout lines into priced items. Prices come only from the current product data, never
 * from the client. All problems are collected so the customer sees them at once.
 */
export function priceCatalogItems(lines: CatalogInput, productsById: Map<string, Product>): OrderItem<CatalogModel>[] {
  const problems: string[] = [];
  const items = lines.flatMap((line, i): OrderItem<CatalogModel>[] => {
    const product = productsById.get(line.productId);
    const label = `${t('item', i + 1)}${product ? ` (${product.name})` : ''}`;
    if (!product || !product.published) {
      problems.push(`${label}: ${t('unavailable')}`);
      return [];
    }
    // Checked before normalization, which would otherwise quietly drop a texture the product no longer offers.
    const textureErrors = customizationTextureErrors(product, line.customization);
    const normalized = normalizeCustomization(product, line.customization);
    const customization = normalizeCustomizationText(normalized);
    const dimensionError = productDimensionsError(product, customization.dimensions);
    const engravingErrors = [
      ...customizationEngravingErrors(product, customization),
      ...customizationExtrudedTextErrors(product, customization),
    ];
    if (dimensionError) problems.push(`${label}: ${dimensionError}`);
    [...engravingErrors, ...textureErrors].forEach(({ message }) => problems.push(`${label}: ${message}`));
    if (dimensionError || engravingErrors.length > 0 || textureErrors.length > 0) return [];

    const { lines: priceLines, unitPrice } = calculatePrice(product, customization);
    return [{
      model: {
        source: 'catalog',
        productId: product.id,
        productName: product.name,
        customization,
        ...summarizeConfiguration(product, customization),
        priceLines,
      },
      quantity: line.quantity,
      unitPrice,
      lineTotal: roundCents(unitPrice * line.quantity),
    }];
  });
  if (problems.length > 0) throw new HttpError(400, t('orderProblems'), problems);
  return items;
}

/** Catalog products at their current prices: a fixed price, handling charged once. */
export async function catalogDraft(db: Storage, lines: CatalogInput): Promise<SourceDraft> {
  const productIds = [...new Set(lines.map((item) => item.productId))];
  const [products, settings] = await Promise.all([db.products.getMany(productIds), db.settings.getPricing()]);
  const pricing = catalogPricing(settings ?? DEFAULT_PRICING);
  const items = priceCatalogItems(lines, new Map(products.map((p) => [p.id, { ...p, catalogPricing: pricing }])));
  return {
    source: 'catalog',
    items,
    price: {
      mode: 'fixed',
      handlingFee: pricing.handlingFee,
      estimated: null,
      reviewed: null,
      total: roundCents(pricing.handlingFee + items.reduce((sum, item) => sum + item.lineTotal!, 0)),
    },
  };
}
