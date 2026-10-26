import { t } from '../i18n';
import { lazy, Suspense, type ComponentProps } from 'react';

const DescriptionEditor = lazy(() => import('./DescriptionEditor').then((module) => ({ default: module.DescriptionEditor })));

export function LazyDescriptionEditor(props: ComponentProps<typeof DescriptionEditor>) {
  return (
    <Suspense fallback={<p role="status">{t("Loading description editor…")}</p>}>
      <DescriptionEditor {...props} />
    </Suspense>
  );
}
