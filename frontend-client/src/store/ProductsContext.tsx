import { t } from '../i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { Product } from '../types';

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };
interface ProductsContextValue {
  products: Product[];
  load: LoadState;
  getProduct: (id: string) => Product | undefined;
  reload: () => Promise<void>;
}
const ProductsContext = createContext<ProductsContextValue | null>(null);

export function ProductsProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const reload = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      setProducts(await api.listProducts());
      setLoad({ status: 'ready' });
    } catch (err) {
      setLoad({ status: 'error', message: err instanceof ApiError ? err.message : t("Could not load products.") });
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const getProduct = useCallback((id: string) => products.find((product) => product.id === id), [products]);
  const value = useMemo(() => ({ products, load, getProduct, reload }), [products, load, getProduct, reload]);
  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

export function useProducts(): ProductsContextValue {
  const context = useContext(ProductsContext);
  if (!context) throw new Error('useProducts must be used inside <ProductsProvider>');
  return context;
}
