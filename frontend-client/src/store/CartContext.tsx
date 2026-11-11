import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { MAX_QUANTITY } from '../config';
import type { CartItem } from '../types';
import { createId } from '../utils/ids';
import { usePersistentState } from './usePersistentState';
import { useProducts } from './ProductsContext';
import { calculatePrice } from '../utils/pricing';
import { normalizeCustomization } from '../utils/customization';
import { productDimensionsError } from '../utils/scaling';

interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  total: number;
  handlingFee: number;
  addItem: (item: Omit<CartItem, 'id' | 'addedAt'>) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const isCart = (value: unknown): value is CartItem[] =>
  Array.isArray(value) && value.every((i) => typeof i?.id === 'string' && typeof i?.unitPrice === 'number');

const clampQuantity = (q: number) => Math.min(MAX_QUANTITY, Math.max(1, Math.round(q)));

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = usePersistentState<CartItem[]>('printforge.cart', () => [], isCart);
  const { products } = useProducts();

  const addItem = useCallback(
    (item: Omit<CartItem, 'id' | 'addedAt'>) =>
      setItems((prev) => [
        ...prev,
        { ...item, quantity: clampQuantity(item.quantity), id: createId('item'), addedAt: new Date().toISOString() },
      ]),
    [setItems],
  );

  const updateQuantity = useCallback(
    (id: string, quantity: number) =>
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: clampQuantity(quantity) } : i))),
    [setItems],
  );

  const removeItem = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), [setItems]);
  const clear = useCallback(() => setItems([]), [setItems]);

  const value = useMemo(() => {
    const pricedItems = items.map((item) => {
      const product = products.find((product) => product.id === item.productId);
      if (!product?.catalogPricing) return item;
      const customization = normalizeCustomization(product, item.customization);
      if (productDimensionsError(product, customization.dimensions)) return item;
      return { ...item, unitPrice: calculatePrice(product, customization).unitPrice };
    });
    const itemCount = pricedItems.reduce((n, i) => n + i.quantity, 0);
    const handlingFee = items.length > 0 ? products.find((product) => product.catalogPricing)?.catalogPricing?.handlingFee ?? 0 : 0;
    const total = Math.round((handlingFee + pricedItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)) * 100) / 100;
    return { items: pricedItems, itemCount, total, handlingFee, addItem, updateQuantity, removeItem, clear };
  }, [items, products, addItem, updateQuantity, removeItem, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
