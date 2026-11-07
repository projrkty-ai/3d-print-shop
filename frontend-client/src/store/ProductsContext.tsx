import { t } from '../i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async (foreground = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (foreground) setLoad({ status: 'loading' });
    try {
      const products = await api.listProducts(controller.signal);
      if (controller.signal.aborted) return;
      setProducts(products);
      setLoad({ status: 'ready' });
    } catch (err) {
      if (controller.signal.aborted) return;
      setLoad({ status: 'error', message: err instanceof ApiError ? err.message : t("Could not load products.") });
    }
  }, []);
  const reload = useCallback(() => refresh(true), [refresh]);
  useEffect(() => {
    void reload();
    const update = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const timer = window.setInterval(update, 15_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      request.current?.abort();
    };
  }, [reload, refresh]);
  const getProduct = useCallback((id: string) => products.find((product) => product.id === id), [products]);
  const value = useMemo(() => ({ products, load, getProduct, reload }), [products, load, getProduct, reload]);
  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

export function useProducts(): ProductsContextValue {
  const context = useContext(ProductsContext);
  if (!context) throw new Error('useProducts must be used inside <ProductsProvider>');
  return context;
}
