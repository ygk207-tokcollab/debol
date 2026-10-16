import { Navigate, Route, Routes } from 'react-router-dom';
import { StoreLayout } from './components/storefront/StoreLayout';
import { AdminLayout } from './components/admin/AdminLayout';
import { RequireAdmin } from './components/admin/RequireAdmin';
import HomePage from './pages/storefront/HomePage';
import CatalogPage from './pages/storefront/CatalogPage';
import ProductPage from './pages/storefront/ProductPage';
import CartPage from './pages/storefront/CartPage';
import CheckoutPage from './pages/storefront/CheckoutPage';
import OrderPlacedPage from './pages/storefront/OrderPlacedPage';
import TrackOrderPage from './pages/storefront/TrackOrderPage';
import AccountPage from './pages/storefront/AccountPage';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import DashboardPage from './pages/admin/DashboardPage';
import AdminProductsPage from './pages/admin/AdminProductsPage';
import AdminProductEditorPage from './pages/admin/AdminProductEditorPage';
import AdminOrdersPage from './pages/admin/AdminOrdersPage';
import AdminOrderDetailPage from './pages/admin/AdminOrderDetailPage';
import AdminInventoryPage from './pages/admin/AdminInventoryPage';
import AdminNotificationsPage from './pages/admin/AdminNotificationsPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import AdminZonesPage from './pages/admin/AdminZonesPage';
import AdminCategoriesPage from './pages/admin/AdminCategoriesPage';
import AdminPeoplePage from './pages/admin/AdminPeoplePage';
import AdminAuditPage from './pages/admin/AdminAuditPage';
import NotFoundPage from './pages/storefront/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route element={<StoreLayout />}>
        <Route index element={<HomePage />} />
        <Route path="products" element={<CatalogPage />} />
        <Route path="products/:slug" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="order/:orderNumber" element={<OrderPlacedPage />} />
        <Route path="track" element={<TrackOrderPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="products" element={<AdminProductsPage />} />
        <Route path="products/new" element={<AdminProductEditorPage />} />
        <Route path="products/:id" element={<AdminProductEditorPage />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="orders/:id" element={<AdminOrderDetailPage />} />
        <Route path="inventory" element={<AdminInventoryPage />} />
        <Route path="notifications" element={<AdminNotificationsPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="zones" element={<AdminZonesPage />} />
        <Route path="categories" element={<AdminCategoriesPage />} />
        <Route path="people" element={<AdminPeoplePage />} />
        <Route path="audit" element={<AdminAuditPage />} />
      </Route>
    </Routes>
  );
}
