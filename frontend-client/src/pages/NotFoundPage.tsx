import { t } from '../i18n';
import { Link } from 'react-router';

export function NotFoundPage({ message = t("We couldn't find that page.") }: { message?: string }) {
  return (
    <div className="empty-state">
      <h1>{t("Not found")}</h1>
      <p>{message}</p>
      <Link to="/" className="btn btn--primary">
        {t("Back to shop")}
      </Link>
    </div>
  );
}
