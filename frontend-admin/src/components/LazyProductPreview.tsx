import { t } from '../i18n';
import { lazy, Suspense, type ComponentProps } from 'react';

// three.js is large; load it only on pages that show a 3D preview.
const ProductPreview = lazy(() => import('./ProductPreview').then((m) => ({ default: m.ProductPreview })));

type Props = ComponentProps<typeof ProductPreview>;

export function LazyProductPreview(props: Props) {
  return (
    <Suspense fallback={<div className={`preview preview--loading ${props.className ?? ''}`}>{t("Loading 3D preview…")}</div>}>
      <ProductPreview {...props} />
    </Suspense>
  );
}
