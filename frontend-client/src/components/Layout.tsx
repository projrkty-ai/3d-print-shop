import { t } from '../i18n';
import { Link, NavLink, Outlet } from 'react-router';
import { SHOP_NAME } from '../config';
import { useCart } from '../store/CartContext';

export function Layout() {
  const { itemCount } = useCart();
  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="header__brand">
          <span className="header__logo" aria-hidden="true">◆</span> {SHOP_NAME}
        </Link>
        <nav className="header__nav">
          <NavLink to="/" end>
            {t("Shop")}
          </NavLink>
          <NavLink to="/cart">
            {t("Cart")}{itemCount > 0 && <span className="badge">{itemCount}</span>}
          </NavLink>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        © {new Date().getFullYear()} {SHOP_NAME} {t("· Printed to order")}
      </footer>
    </div>
  );
}
