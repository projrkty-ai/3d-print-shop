import { randomInt, randomUUID } from 'node:crypto';
import { CURRENCY } from './domain/config';
import type { Order, OrderInput, OrderItem, Product } from './domain/types';
import { normalizeCustomization, normalizeCustomizationText } from './domain/utils/customization';
import { summarizeConfiguration } from './domain/utils/orderLines';
import { calculatePrice } from './domain/utils/pricing';
import { validateDimensions } from './domain/utils/sizing';
import { customizationEngravingErrors, customizationExtrudedTextErrors, customizationTextureErrors } from './domain/utils/validation';
import { DuplicateOrderNumberError, type Storage } from './storage';
import { HttpError } from './http';
import { t } from './i18n';

const roundCents = (value: number) => Math.round(value * 100) / 100;

/**
 * Turns checkout input into priced order items. Prices come only from the current product
 * data, never from the client. All problems are collected so the customer sees them at once.
 */
export function priceOrderItems(input: OrderInput, productsById: Map<string, Product>): OrderItem[] {
  const problems: string[] = [];
  const items = input.items.flatMap((line, i): OrderItem[] => {
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
    const dimensionError = validateDimensions(customization.dimensions);
    const engravingErrors = [
      ...customizationEngravingErrors(product, customization),
      ...customizationExtrudedTextErrors(product, customization),
    ];
    if (dimensionError) problems.push(`${label}: ${dimensionError}`);
    [...engravingErrors, ...textureErrors].forEach(({ message }) => problems.push(`${label}: ${message}`));
    if (dimensionError || engravingErrors.length > 0 || textureErrors.length > 0) return [];

    const { lines, unitPrice } = calculatePrice(product, customization);
    return [
      {
        productId: product.id,
        productName: product.name,
        customization,
        ...summarizeConfiguration(product, customization),
        unitPrice,
        quantity: line.quantity,
        priceLines: lines,
        lineTotal: roundCents(unitPrice * line.quantity),
      },
    ];
  });
  if (problems.length > 0) throw new HttpError(400, t('orderProblems'), problems);
  return items;
}

/** Short, unambiguous characters (no 0/O, 1/I) for order numbers read out over the phone. */
const NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function orderNumber(date: Date): string {
  const day = date.toISOString().slice(2, 10).replaceAll('-', '');
  const suffix = Array.from({ length: 4 }, () => NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)]).join('');
  return `PF-${day}-${suffix}`;
}

export async function createOrder(db: Storage, input: OrderInput): Promise<Order> {
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await db.products.getMany(productIds);
  const items = priceOrderItems(input, new Map(products.map((p) => [p.id, p])));

  const now = new Date();
  const order: Order = {
    id: randomUUID(),
    number: '',
    status: 'pending',
    customer: input.customer,
    items,
    total: roundCents(items.reduce((sum, item) => sum + item.lineTotal, 0)),
    currency: CURRENCY,
    ...(input.customerNote && { customerNote: input.customerNote }),
    adminNote: '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  // Order numbers are random; on the rare collision, draw another.
  for (let attempt = 0; ; attempt++) {
    order.number = orderNumber(now);
    try {
      await db.orders.insert(order);
      return order;
    } catch (err) {
      if (!(err instanceof DuplicateOrderNumberError) || attempt >= 5) throw err;
    }
  }
}
