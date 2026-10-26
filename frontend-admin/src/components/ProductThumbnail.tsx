import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { MeshFile, PreviewShape, Product } from '../types';
import { ShapeIcon } from './ShapeIcon';

type ThumbnailState = { status: 'loading' } | { status: 'ready'; image: string } | { status: 'error'; message: string };

function ModelThumbnail({ mesh, shape, color }: { mesh: MeshFile; shape: PreviewShape; color: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [state, setState] = useState<ThumbnailState>({ status: 'loading' });
  const platesKey = mesh.selectedPlates?.join(',');

  useEffect(() => {
    if (visible || !container.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    import('../utils/modelThumbnail')
      .then(({ modelThumbnail }) => modelThumbnail({
        url: mesh.url,
        plate: mesh.plate,
        plates: platesKey === undefined ? undefined : platesKey.split(',').map(Number),
        color,
      }))
      .then((image) => {
        if (!cancelled) setState({ status: 'ready', image });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn(t("Could not create product model thumbnail"), error);
        setState({ status: 'error', message: error instanceof Error ? error.message : t("The model thumbnail could not be loaded.") });
      });
    return () => { cancelled = true; };
  }, [visible, mesh.url, mesh.plate, platesKey, color]);

  return (
    <div className="product-thumbnail" ref={container}>
      {state.status === 'ready' ? <img src={state.image} alt="" /> : (
        <>
          <ShapeIcon shape={shape} color={color} />
          <span className="product-thumbnail__status" title={state.status === 'error' ? state.message : undefined}>
            {state.status === 'error' ? t("Preview unavailable") : t("Loading preview…")}
          </span>
        </>
      )}
    </div>
  );
}

export function ProductThumbnail({ product }: { product: Product }) {
  const color = product.colors[0]?.hex ?? '#cccccc';
  if (product.imageUrl) {
    return <div className="product-thumbnail product-thumbnail--photo"><img src={resolveAssetUrl(product.imageUrl)} alt="" loading="lazy" /></div>;
  }
  if (!product.mesh) {
    return <div className="product-thumbnail"><ShapeIcon shape={product.shape} color={color} /></div>;
  }
  const key = JSON.stringify([product.mesh.url, product.mesh.plate, product.mesh.selectedPlates, color]);
  return <ModelThumbnail key={key} mesh={product.mesh} shape={product.shape} color={color} />;
}
import { resolveAssetUrl } from '../api/urls';
