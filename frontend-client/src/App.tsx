import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { CustomPrintPage } from './pages/CustomPrintPage';
import { ModelSearchPage } from './pages/ModelSearchPage';
import { ReadyToPrintPage } from './pages/ReadyToPrintPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductPage } from './pages/ProductPage';
import { CartProvider } from './store/CartContext';
import { CustomPrintProvider } from './store/CustomPrintContext';
import { ProductsProvider } from './store/ProductsContext';

export function App() {
  return (
    <ProductsProvider>
      <CartProvider>
        <CustomPrintProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<CatalogPage />} />
                <Route path="product/:productId" element={<ProductPage />} />
                <Route path="print-your-model" element={<CustomPrintPage />} />
                <Route path="cart" element={<CartPage />} />
                <Route path="search" element={<ModelSearchPage />} />
                <Route path="print-on-demand" element={<ReadyToPrintPage />} />
                {/* The tab's former address. */}
                <Route path="ready-to-print" element={<Navigate to="/print-on-demand" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </CustomPrintProvider>
      </CartProvider>
    </ProductsProvider>
  );
}
