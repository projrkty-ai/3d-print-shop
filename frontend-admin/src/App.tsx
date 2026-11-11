import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { Layout } from './components/Layout';
import { AdminEmailTemplatesPage } from './pages/admin/AdminEmailTemplatesPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminOrderPage } from './pages/admin/AdminOrderPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import { AdminPricingPage } from './pages/admin/AdminPricingPage';
import { AdminPrinterModelPage } from './pages/admin/AdminPrinterModelPage';
import { AdminPrinterModelsPage } from './pages/admin/AdminPrinterModelsPage';
import { AdminPrinterQueuePage } from './pages/admin/AdminPrinterQueuePage';
import { AdminPrintersPage } from './pages/admin/AdminPrintersPage';
import { AdminProjectProductPage } from './pages/admin/AdminProjectProductPage';
import { AdminProjectProductsPage } from './pages/admin/AdminProjectProductsPage';
import { AdminSlicerPage } from './pages/admin/AdminSlicerPage';
import { ProductEditorPage } from './pages/admin/ProductEditorPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductPreviewPage } from './pages/ProductPreviewPage';
import { AdminAuthProvider } from './store/AdminAuthContext';
import { ProductsProvider } from './store/ProductsContext';

/** A Print on Demand product at its former (ready-to-print) address. */
function LegacyProductRedirect() {
  const { productId = '' } = useParams();
  return <Navigate to={`/admin/print-on-demand/${encodeURIComponent(productId)}`} replace />;
}

/** A print request or project order at its former address: every order is now under Orders. */
function LegacyOrderRedirect() {
  const { orderId = '' } = useParams();
  return <Navigate to={`/admin/orders/${encodeURIComponent(orderId)}`} replace />;
}

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
                {/* Print requests and project orders: their former lists and pages. */}
                <Route path="custom-orders" element={<Navigate to="/admin/orders?source=upload" replace />} />
                <Route path="custom-orders/:orderId" element={<LegacyOrderRedirect />} />
                <Route path="project-orders" element={<Navigate to="/admin/orders?source=project" replace />} />
                <Route path="project-orders/:orderId" element={<LegacyOrderRedirect />} />
                <Route path="print-options" element={<Navigate to="/admin/pricing" replace />} />
                <Route path="email-templates" element={<AdminEmailTemplatesPage />} />
                <Route path="print-on-demand" element={<AdminProjectProductsPage />} />
                <Route path="print-on-demand/:productId" element={<AdminProjectProductPage />} />
                {/* The tab's former addresses. */}
                <Route path="ready-to-print" element={<Navigate to="/admin/print-on-demand" replace />} />
                <Route path="ready-to-print/:productId" element={<LegacyProductRedirect />} />
                <Route path="pricing" element={<AdminPricingPage />} />
                <Route path="slicer" element={<AdminSlicerPage />} />
                <Route path="printers" element={<AdminPrintersPage />} />
                <Route path="printers/:printerId" element={<AdminPrinterQueuePage />} />
                <Route path="printer-models" element={<AdminPrinterModelsPage />} />
                <Route path="printer-models/new" element={<AdminPrinterModelPage />} />
                <Route path="printer-models/:modelId" element={<AdminPrinterModelPage />} />
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
