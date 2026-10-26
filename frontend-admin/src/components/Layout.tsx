import { t } from '../i18n';
import { Link, Outlet } from 'react-router';
import { SHOP_NAME } from '../config';

export function Layout() {
  return (
    <div className="app">
      <header className="header">
        <Link to="/admin" className="header__brand">{SHOP_NAME} {t("Admin")}</Link>
        <nav className="header__nav">
          <a href={import.meta.env.VITE_STOREFRONT_URL || 'http://localhost:5173'}>{t("Open shop")}</a>
        </nav>
      </header>
      <main className="main"><Outlet /></main>
      <footer className="footer">{SHOP_NAME} {t("· Product and order administration")}</footer>
    </div>
  );
}
