import { t } from '../i18n';
import { useState } from 'react';
import { Link } from 'react-router';
import { ConfigurationDetails, ItemSwatch } from '../components/ConfiguredItem';
import { MAX_QUANTITY } from '../config';
import { useCart } from '../store/CartContext';
import type { Order } from '../types';
import { formatPrice } from '../utils/pricing';
import { CheckoutForm } from './CheckoutForm';

export function CartPage() {
  const { items, total, updateQuantity, removeItem, clear } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  // The placed order, with the cart total it replaced (to explain any price change).
  const [placed, setPlaced] = useState<{ order: Order; cartTotal: number } | null>(null);

  if (placed) return <OrderConfirmation {...placed} />;

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <h1>{t("Your cart is empty")}</h1>
        <Link to="/" className="btn btn--primary">
          {t("Browse products")}
        </Link>
      </div>
    );
  }

  return (
    <div className="cart">
      <h1>{t("Your cart")}</h1>
      <ul className="cart__items">
        {items.map((item) => (
          <li key={item.id} className="cart-item">
            <ItemSwatch item={item} />
            <div className="cart-item__info">
              <Link to={`/product/${item.productId}`} className="cart-item__name">
                {item.productName}
              </Link>
              <ConfigurationDetails item={item} />
            </div>
            <div className="cart-item__controls">
              <input
                type="number"
                min={1}
                max={MAX_QUANTITY}
                value={item.quantity}
                aria-label={t("Quantity of {value0}", { value0: item.productName })}
                onChange={(e) => Number.isFinite(e.target.valueAsNumber) && updateQuantity(item.id, e.target.valueAsNumber)}
                disabled={checkingOut}
              />
              <span className="cart-item__price">{formatPrice(item.unitPrice * item.quantity)}</span>
              <button
                type="button"
                className="btn btn--ghost btn--danger"
                onClick={() => removeItem(item.id)}
                disabled={checkingOut}
              >
                {t("Remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="cart__footer">
        <button type="button" className="btn btn--ghost" onClick={clear} disabled={checkingOut}>
          {t("Clear cart")}
        </button>
        <div className="cart__total">
          {t("Total")} <strong>{formatPrice(total)}</strong>
        </div>
        {!checkingOut && (
          <button type="button" className="btn btn--primary btn--large" onClick={() => setCheckingOut(true)}>
            {t("Checkout")}
          </button>
        )}
      </div>
      {checkingOut && (
        <CheckoutForm
          items={items}
          onCancel={() => setCheckingOut(false)}
          onPlaced={(order) => {
            setPlaced({ order, cartTotal: total });
            clear();
          }}
        />
      )}
    </div>
  );
}

function OrderConfirmation({ order, cartTotal }: { order: Order; cartTotal: number }) {
  return (
    <div className="card order-confirmation" role="status">
      <h1>{t("Thank you for your order!")}</h1>
      <p>
        {t("Your order number is")} <strong className="mono">{order.number}</strong>{t(". Keep it for any questions about your order.")}
      </p>
      <p>
        {t("Total:")} <strong>{formatPrice(order.total)}</strong>
        {order.total !== cartTotal && (
          <span className="muted"> {t("(prices changed since the items were added to your cart: was")} {formatPrice(cartTotal)})</span>
        )}
      </p>
      <p className="muted">
        {t("We'll contact you at")} {order.customer.email} {t("to confirm the order and arrange payment.")}
      </p>
      <Link to="/" className="btn btn--primary">
        {t("Continue shopping")}
      </Link>
    </div>
  );
}
