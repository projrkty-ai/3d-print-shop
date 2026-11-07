import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { AdminCustomOrderPage } from './pages/admin/AdminCustomOrderPage';
import { AdminCustomOrdersPage } from './pages/admin/AdminCustomOrdersPage';
import { AdminEmailTemplatesPage } from './pages/admin/AdminEmailTemplatesPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminOrderPage } from './pages/admin/AdminOrderPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import { AdminProjectOrderPage } from './pages/admin/AdminProjectOrderPage';
import { AdminProjectOrdersPage } from './pages/admin/AdminProjectOrdersPage';
import { AdminPricingPage } from './pages/admin/AdminPricingPage';
import { AdminProjectProductPage } from './pages/admin/AdminProjectProductPage';
import { AdminProjectProductsPage } from './pages/admin/AdminProjectProductsPage';
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
                <Route path="custom-orders" element={<AdminCustomOrdersPage />} />
                <Route path="custom-orders/:orderId" element={<AdminCustomOrderPage />} />
                <Route path="print-options" element={<Navigate to="/admin/pricing" replace />} />
                <Route path="email-templates" element={<AdminEmailTemplatesPage />} />
                <Route path="project-orders" element={<AdminProjectOrdersPage />} />
                <Route path="project-orders/:orderId" element={<AdminProjectOrderPage />} />
                <Route path="ready-to-print" element={<AdminProjectProductsPage />} />
                <Route path="ready-to-print/:productId" element={<AdminProjectProductPage />} />
                <Route path="pricing" element={<AdminPricingPage />} />
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
