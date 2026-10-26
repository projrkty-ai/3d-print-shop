import { useCallback, type SetStateAction } from 'react';
import { MAX_QUANTITY } from '../config';
import type { Customization, Dimensions, Product, SurfaceCustomization } from '../types';
import { defaultCustomization, normalizeCustomization } from '../utils/customization';
import { usePersistentState } from './usePersistentState';

type SavedCustomization = Omit<Customization, 'dimensions'> & {
  /** A cleared numeric input is NaN in memory and null in JSON. */
  dimensions: { [Axis in keyof Dimensions]: number | null };
};

interface ProductDraft {
  version: 1;
  customization: SavedCustomization;
  quantity: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isSurface(value: unknown): value is SurfaceCustomization {
  return isRecord(value) &&
    typeof value.colorId === 'string' &&
    isRecord(value.partColors) && Object.values(value.partColors).every((color) => typeof color === 'string') &&
    typeof value.engravingText === 'string' &&
    typeof value.engravingFont === 'string' &&
    (value.engravingColorId === null || typeof value.engravingColorId === 'string') &&
    (value.textureDataUrl === null || (
      typeof value.textureDataUrl === 'string' && value.textureDataUrl.length <= 3_000_000 &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value.textureDataUrl)
    ));
}

function isProductDraft(value: unknown): value is ProductDraft {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.customization)) return false;
  const customization = value.customization;
  const dimensions = customization.dimensions;
  return isSurface(customization) && isRecord(dimensions) &&
    ['widthMm', 'depthMm', 'heightMm'].every((axis) =>
      dimensions[axis] === null || (typeof dimensions[axis] === 'number' && Number.isFinite(dimensions[axis])),
    ) &&
    (customization.plates === undefined || (
      isRecord(customization.plates) && Object.values(customization.plates).every(isSurface)
    )) &&
    typeof value.quantity === 'number' && Number.isInteger(value.quantity) && value.quantity >= 1 && value.quantity <= MAX_QUANTITY;
}

function saveCustomization(customization: Customization): SavedCustomization {
  const { widthMm, depthMm, heightMm } = customization.dimensions;
  return {
    ...customization,
    dimensions: {
      widthMm: Number.isFinite(widthMm) ? widthMm : null,
      depthMm: Number.isFinite(depthMm) ? depthMm : null,
      heightMm: Number.isFinite(heightMm) ? heightMm : null,
    },
  };
}

function restoreCustomization(customization: SavedCustomization): Customization {
  const { widthMm, depthMm, heightMm } = customization.dimensions;
  return {
    ...customization,
    dimensions: { widthMm: widthMm ?? NaN, depthMm: depthMm ?? NaN, heightMm: heightMm ?? NaN },
  };
}

export function useProductDraft(product: Product) {
  const [saved, setSaved, persistenceError] = usePersistentState<ProductDraft>(
    `printforge.productDraft:${product.id}`,
    () => ({ version: 1, customization: saveCustomization(defaultCustomization(product)), quantity: 1 }),
    isProductDraft,
    (draft) => ({
      ...draft,
      customization: saveCustomization(normalizeCustomization(product, restoreCustomization(draft.customization))),
    }),
  );
  const setDraft = useCallback((update: SetStateAction<Customization>) => {
    setSaved((previous) => ({
      ...previous,
      customization: saveCustomization(typeof update === 'function' ? update(restoreCustomization(previous.customization)) : update),
    }));
  }, [setSaved]);
  const setQuantity = useCallback((quantity: number) => {
    setSaved((previous) => ({ ...previous, quantity }));
  }, [setSaved]);
  return { draft: restoreCustomization(saved.customization), setDraft, quantity: saved.quantity, setQuantity, persistenceError };
}
