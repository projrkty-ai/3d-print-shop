import type { PreviewShape } from '../types';

const PATHS: Record<PreviewShape, string> = {
  vase: 'M38 10h24v6c0 6-10 10-10 22 0 14 16 20 16 38 0 10-6 14-6 14H38s-6-4-6-14c0-18 16-24 16-38 0-12-10-16-10-22z',
  cylinder: 'M28 22c0-6 44-6 44 0v56c0 6-44 6-44 0z',
  box: 'M50 18l30 14v36L50 82 20 68V32z',
  sphere: 'M50 16a34 34 0 1 1 0 68 34 34 0 1 1 0-68z',
};

/** Simple silhouette used as a placeholder when a product has no photo. */
export function ShapeIcon({ shape, color }: { shape: PreviewShape; color: string }) {
  return (
    <svg viewBox="0 0 100 100" className="shape-icon" aria-hidden="true">
      <path d={PATHS[shape]} fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
      {shape === 'box' && <path d="M20 32l30 14 30-14M50 46v36" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />}
    </svg>
  );
}
