import { t } from '../i18n';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { loadModelBuffer } from '../api/client';
import type { DecorationLayout, PreviewShape } from '../types';
import { MeshFileError, parseMeshFile, prepareMeshForPreview, type PreparedMesh, type SurfaceSpec } from '../utils/mesh';
import { DecoratedSurface, loadPicture } from '../utils/decoratedSurface';
import type { ExtrudedTextPlacement } from '../utils/extrudedText';
import { SHAPES } from '../utils/previewShapes';

const GROUND_Y = -1;
/** Displayed scale range; prints outside it are shown at the nearest bound. */
const PREVIEW_MAX_SCALE = 1.2;
const PREVIEW_MIN_SCALE = 0.6;

function useLoadedImage(src: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    let cancelled = false;
    loadPicture(src).then((loaded) => !cancelled && setImage(loaded), () => !cancelled && setImage(null));
    return () => {
      cancelled = true;
    };
  }, [src]);
  return image;
}

/** Scale relative to the original model along x (width), y (height) and z (depth). */
export type PreviewScale = [number, number, number];

/**
 * Keeps very large or very small prints inside the frame. Proportions are preserved,
 * so the model still visibly grows and shrinks, but within a comfortable range.
 */
function fitToView(scale: PreviewScale): PreviewScale {
  const largest = Math.max(...scale);
  let factor = 1;
  if (largest > PREVIEW_MAX_SCALE) factor = PREVIEW_MAX_SCALE / largest;
  else if (largest < PREVIEW_MIN_SCALE) factor = PREVIEW_MIN_SCALE / largest;
  return scale.map((s) => s * factor) as PreviewScale;
}

/** What the customer has chosen; applies to built-in shapes and model files alike. */
interface AppearanceProps {
  color: string;
  scale: PreviewScale;
  engravingText: string;
  engravingFont: string;
  /** Fill color for the engraved letters; null leaves them in the print color. */
  engravingColor?: string | null;
  /** Picture embossed on the surface: the customer's data URL or a resolved shop texture URL. */
  textureUrl: string | null;
  decorationLayout?: DecorationLayout;
  /** Raised 3D lettering placed by the shop, with the customer's text and size. */
  extrudedText?: ExtrudedTextPlacement | null;
}

interface SurfaceMeshProps extends Omit<AppearanceProps, 'color'> {
  geometry: THREE.BufferGeometry;
  spec: SurfaceSpec;
  /** Color of each part (indexed by `spec.slotParts`); single-color meshes pass one color. */
  colors: string[];
}

/** Renders geometry in its filament color(s), with the engraving and picture texture painted on. */
function SurfaceMesh({
  geometry,
  spec,
  colors,
  scale,
  engravingText,
  engravingFont,
  engravingColor = null,
  textureUrl,
  decorationLayout,
  extrudedText = null,
}: SurfaceMeshProps) {
  const image = useLoadedImage(textureUrl);
  const surface = useMemo(() => new DecoratedSurface(spec), [spec]);
  useEffect(() => () => surface.dispose(), [surface]);

  // The lettering mesh; rebuilt when the text, size or placement changes.
  const extrudedKey = extrudedText ? JSON.stringify(extrudedText) : null;
  const letteringGeometry = useMemo(() => {
    if (!extrudedKey) return null;
    geometry.computeBoundingBox();
    return import('../utils/extrudedText').then(({ extrudedTextGeometry }) =>
      extrudedTextGeometry(JSON.parse(extrudedKey) as ExtrudedTextPlacement, geometry.boundingBox!));
  }, [extrudedKey, geometry]);
  const lettering = usePromised(letteringGeometry);
  useEffect(() => () => {
    void Promise.resolve(letteringGeometry).then((resolved) => resolved?.dispose());
  }, [letteringGeometry]);

  // A string key, so a new-but-equal colors array doesn't force a material update every render.
  const colorsKey = colors.join(',');
  useEffect(() => surface.setColors(colorsKey.split(',')), [surface, colorsKey]);
  useEffect(() => {
    surface.paint({ image, text: engravingText, font: engravingFont, layout: decorationLayout });
  }, [surface, image, engravingText, engravingFont, decorationLayout]);
  useEffect(() => surface.setEngravingColor(engravingColor), [surface, engravingColor]);

  const displayScale = fitToView(scale);

  return (
    <group rotation-y={spec.rotationY} scale={displayScale} position-y={GROUND_Y - spec.bottomY * displayScale[1]}>
      <mesh geometry={geometry} material={spec.slots ? surface.materials : surface.materials[0]} castShadow />
      {lettering && (
        <mesh geometry={lettering} castShadow>
          <meshStandardMaterial color={colors[0]} roughness={0.55} metalness={0.05} />
        </mesh>
      )}
    </group>
  );
}

/** Latest resolved value of a possibly-async computation (the lettering font loads lazily). */
function usePromised<T>(value: T | Promise<T | null> | null): T | null {
  const [resolved, setResolved] = useState<T | null>(null);
  useEffect(() => {
    if (!value || !(value instanceof Promise)) {
      setResolved(value);
      return;
    }
    let cancelled = false;
    value.then((result) => !cancelled && setResolved(result), () => !cancelled && setResolved(null));
    return () => {
      cancelled = true;
    };
  }, [value]);
  return resolved;
}

function ShapeModel({ shape, color, ...appearance }: AppearanceProps & { shape: PreviewShape }) {
  const spec = SHAPES[shape];
  const geometry = useMemo(() => spec.createGeometry(), [spec]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <SurfaceMesh geometry={geometry} spec={spec} colors={[color]} {...appearance} />;
}

type MeshState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; mesh: PreparedMesh }
  | { status: 'error'; message: string };

/** Downloads and prepares an STL/3MF file; disposes the geometry when the URL changes. */
function useMeshFile(url: string | null | undefined, plate: number | null, plates?: number[]): MeshState {
  const [state, setState] = useState<MeshState>(() => (url ? { status: 'loading' } : { status: 'none' }));
  const platesKey = plates?.join(',');

  useEffect(() => {
    if (!url) {
      setState({ status: 'none' });
      return;
    }
    let cancelled = false;
    let prepared: PreparedMesh | null = null;
    setState({ status: 'loading' });
    loadModelBuffer(url)
      .then((buffer) => {
        if (cancelled) return;
        const raw = parseMeshFile(buffer, { plate, plates: platesKey === undefined ? undefined : platesKey.split(',').map(Number) });
        try {
          prepared = prepareMeshForPreview(raw);
        } finally {
          raw.dispose();
        }
        setState({ status: 'ready', mesh: prepared });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn(t("Could not load 3D model preview"), err);
        setState({ status: 'error', message: err instanceof MeshFileError ? err.message : t("The 3D model could not be loaded.") });
      });
    return () => {
      cancelled = true;
      prepared?.geometry.dispose();
    };
  }, [url, plate, platesKey]);

  return state;
}

interface ProductPreviewProps extends AppearanceProps {
  shape: PreviewShape;
  /** STL or 3MF file to show instead of the generic shape. */
  meshUrl?: string | null;
  /** For multi-plate slicer projects: which plate to show. */
  meshPlate?: number | null;
  /** All plates included in the product, laid out side by side. */
  meshPlates?: number[];
  /**
   * Colors for the parts of a multi-color model file, by part key. Parts not listed show
   * the color from the file; single-color models use `color` instead.
   */
  partColors?: Record<string, string>;
  className?: string;
  /** Short text overlaid on the preview, e.g. the print dimensions. */
  caption?: string;
}

export function ProductPreview({
  shape,
  meshUrl,
  meshPlate = null,
  meshPlates,
  partColors,
  className,
  caption,
  ...appearance
}: ProductPreviewProps) {
  const mesh = useMeshFile(meshUrl, meshPlate, meshPlates);
  const { color, ...surfaceAppearance } = appearance;
  const meshColors =
    mesh.status === 'ready' && mesh.mesh.parts.length > 0
      ? mesh.mesh.parts.map((part) => partColors?.[part.key] ?? part.color)
      : [color];
  return (
    <div className={`preview ${className ?? ''}`}>
      <Canvas camera={{ position: [0, 0.8, 5.8], fov: 40 }} dpr={[1, 2]} shadows>
        <color attach="background" args={['#eef1f5']} />
        <hemisphereLight args={['#ffffff', '#b9c1cc', 1.4]} />
        <directionalLight position={[3, 5, 4]} intensity={2} castShadow />
        <directionalLight position={[-4, 2, 4]} intensity={0.9} />
        <directionalLight position={[-3, 3, -4]} intensity={0.5} />
        {mesh.status === 'ready' && (
          <SurfaceMesh geometry={mesh.mesh.geometry} spec={mesh.mesh.surface} colors={meshColors} {...surfaceAppearance} />
        )}
        {(mesh.status === 'none' || mesh.status === 'error') && <ShapeModel shape={shape} {...appearance} />}
        <ContactShadows position={[0, GROUND_Y, 0]} opacity={0.45} scale={6} blur={2.4} far={3} />
        <OrbitControls
          enablePan={false}
          minDistance={3}
          maxDistance={9}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 1.9}
          target={[0, 0, 0]}
        />
      </Canvas>
      {caption && <p className="preview__caption">{caption}</p>}
      {mesh.status === 'loading' && <p className="preview__status">{t("Loading 3D model…")}</p>}
      {mesh.status === 'error' && (
        <p className="preview__status preview__status--error">{mesh.message} {t("Showing a generic shape instead.")}</p>
      )}
      <p className="preview__hint">{t("Drag to rotate · scroll to zoom")}</p>
    </div>
  );
}
