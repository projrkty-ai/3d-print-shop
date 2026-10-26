import { t } from '../i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type ProductBody } from '../api/client';
import type { Product } from '../types';
import { useAdminAuth } from './AdminAuthContext';

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

interface ProductsContextValue {
  products: Product[];
  load: LoadState;
  getProduct: (id: string) => Product | undefined;
  reload: () => Promise<void>;
  createProduct: (product: ProductBody) => Promise<Product>;
  updateProduct: (id: string, product: ProductBody) => Promise<Product>;
  deleteProduct: (id: string) => Promise<void>;
}

const ProductsContext = createContext<ProductsContextValue | null>(null);

/** Products come from the API: customers get published ones, signed-in admins get all. */
export function ProductsProvider({ children }: { children: ReactNode }) {
  const { token } = useAdminAuth();
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

  // Signing in or out changes which products the API returns.
  useEffect(() => {
    void reload();
  }, [reload, token]);

  const getProduct = useCallback((id: string) => products.find((p) => p.id === id), [products]);

  const createProduct = useCallback(async (body: ProductBody) => {
    const created = await api.createProduct(body);
    setProducts((prev) => [...prev, created]);
    return created;
  }, []);

  const updateProduct = useCallback(async (id: string, body: ProductBody) => {
    const updated = await api.updateProduct(id, body);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, []);

  const deleteProduct = useCallback(async (id: string) => {
    await api.deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const value = useMemo(
    () => ({ products, load, getProduct, reload, createProduct, updateProduct, deleteProduct }),
    [products, load, getProduct, reload, createProduct, updateProduct, deleteProduct],
  );

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

export function useProducts(): ProductsContextValue {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error('useProducts must be used inside <ProductsProvider>');
  return ctx;
}
