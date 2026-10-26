import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminOrderPage } from './pages/admin/AdminOrderPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import { ProductEditorPage } from './pages/admin/ProductEditorPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductPreviewPage } from './pages/ProductPreviewPage';
import { AdminAuthProvider } from './store/AdminAuthContext';
import { ProductsProvider } from './store/ProductsContext';

export function App() {
  return (
    <AdminAuthProvider>
      <ProductsProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/admin" replace />} />
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<AdminProductsPage />} />
                <Route path="products/new" element={<ProductEditorPage />} />
                <Route path="products/:productId" element={<ProductEditorPage />} />
                <Route path="orders" element={<AdminOrdersPage />} />
                <Route path="orders/:orderId" element={<AdminOrderPage />} />
              </Route>
              <Route path="product/:productId" element={<AdminLayout />}>
                <Route index element={<ProductPreviewPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ProductsProvider>
    </AdminAuthProvider>
  );
}
