import { t } from '../i18n';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { loadModelBuffer } from '../api/client';
import type { DecorationLayout, PreviewShape } from '../types';
import { MeshFileError, parseMeshFile, prepareMeshForPreview, type PreparedMesh, type SurfaceSpec } from '../utils/mesh';
import { CANVAS_W, CANVAS_H, paintSurface, paintEngravingMask } from '../utils/surfacePainting';

const GROUND_Y = -1;
/** Displayed scale range; prints outside it are shown at the nearest bound. */
const PREVIEW_MAX_SCALE = 1.2;
const PREVIEW_MIN_SCALE = 0.6;

/** Built-in preview geometry. Material slots: front = texture + engraving, side = texture only, plain = color only. */
interface ShapeSpec extends SurfaceSpec {
  createGeometry: () => THREE.BufferGeometry;
}

function vaseGeometry() {
  const points: THREE.Vector2[] = [new THREE.Vector2(0, -1)];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = 0.45 + 0.38 * Math.sin(Math.PI * Math.min(t * 1.15, 1)) + 0.15 * t ** 4;
    points.push(new THREE.Vector2(r, t * 2 - 1));
  }
  return new THREE.LatheGeometry(points, 96);
}

const SHAPES: Record<PreviewShape, ShapeSpec> = {
  vase: {
    createGeometry: vaseGeometry,
    rotationY: Math.PI,
    surfaceAspect: 2,
    textWidthFraction: 0.28,
    bottomY: -1,
    doubleSided: true,
  },
  cylinder: {
    createGeometry: () => new THREE.CylinderGeometry(0.75, 0.75, 1.8, 96),
    slots: ['front', 'plain', 'plain'],
    rotationY: Math.PI,
    surfaceAspect: (2 * Math.PI * 0.75) / 1.8,
    textWidthFraction: 0.3,
    bottomY: -0.9,
  },
  box: {
    createGeometry: () => new THREE.BoxGeometry(1.5, 1.5, 1.5),
    // BoxGeometry groups: +x, -x, +y, -y, +z (front), -z
    slots: ['side', 'side', 'plain', 'plain', 'front', 'side'],
    rotationY: -Math.PI / 7,
    surfaceAspect: 1,
    textWidthFraction: 0.8,
    bottomY: -0.75,
  },
  sphere: {
    createGeometry: () => new THREE.SphereGeometry(1, 96, 64),
    rotationY: -Math.PI / 2,
    surfaceAspect: 2,
    textWidthFraction: 0.22,
    bottomY: -1,
  },
};

function useLoadedImage(src: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => !cancelled && setImage(img);
    img.onerror = () => !cancelled && setImage(null);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return image;
}

/** A canvas-backed color map + bump map pair that is repainted in place. */
function useSurfaceTextures() {
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const bump = new THREE.CanvasTexture(canvas);
    // Model-file UVs may exceed 1 where triangles cross the seam at the back; wrap instead of clamping.
    map.wrapS = bump.wrapS = THREE.RepeatWrapping;
    return { canvas, map, bump };
  }, []);

  useEffect(
    () => () => {
      surface.map.dispose();
      surface.bump.dispose();
    },
    [surface],
  );
  return surface;
}

/**
 * Text color for the engraving. Front materials sample the engraving mask and replace their
 * color with `engravingColor` inside the letters (strength 0 = plain groove in the print color).
 * The uniform objects are shared by every front material, so a color change needs no recompile.
 */
function useEngravingColorUniforms() {
  const engraving = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const mask = new THREE.CanvasTexture(canvas);
    mask.wrapS = THREE.RepeatWrapping; // same UV wrapping as the surface map
    const uniforms = {
      engravingColor: { value: new THREE.Color() },
      engravingMask: { value: mask },
      engravingStrength: { value: 0 },
    };
    return { canvas, mask, uniforms };
  }, []);
  useEffect(() => () => engraving.mask.dispose(), [engraving]);
  return engraving;
}

function addEngravingColor(material: THREE.MeshStandardMaterial, uniforms: ReturnType<typeof useEngravingColorUniforms>['uniforms']) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 engravingColor;\nuniform sampler2D engravingMask;\nuniform float engravingStrength;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          diffuseColor.rgb = mix(diffuseColor.rgb, engravingColor, texture2D(engravingMask, vMapUv).r * engravingStrength);
        #endif`,
      );
  };
  // Keep these programs apart from plain materials with otherwise identical settings.
  material.customProgramCacheKey = () => 'engraving-color';
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
  textureDataUrl: string | null;
  decorationLayout?: DecorationLayout;
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
  textureDataUrl,
  decorationLayout,
}: SurfaceMeshProps) {
  const image = useLoadedImage(textureDataUrl);
  const front = useSurfaceTextures();
  const side = useSurfaceTextures();
  const engraving = useEngravingColorUniforms();

  // One material per slot, since slots of different parts need different colors.
  const materials = useMemo(() => {
    const make = (textures?: { map: THREE.Texture; bump: THREE.Texture }) =>
      new THREE.MeshStandardMaterial({
        roughness: 0.55,
        metalness: 0.05,
        map: textures?.map ?? null,
        bumpMap: textures?.bump ?? null,
        bumpScale: 4,
      });
    return (spec.slots ?? ['front']).map((slot) => {
      if (slot !== 'front') return make(slot === 'side' ? side : undefined);
      const material = make(front);
      addEngravingColor(material, engraving.uniforms);
      return material;
    });
  }, [front, side, engraving, spec]);

  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  // A string key, so a new-but-equal colors array doesn't force a material update every render.
  const colorsKey = colors.join(',');
  useEffect(() => {
    const sideMode = spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    const partColors = colorsKey.split(',');
    materials.forEach((m, i) => {
      m.color.set(partColors[spec.slotParts?.[i] ?? 0] ?? partColors[0]);
      m.side = sideMode;
      m.needsUpdate = true;
    });
  }, [materials, colorsKey, spec]);

  useEffect(() => {
    paintSurface(front.canvas, { image, text: engravingText, font: engravingFont, spec, layout: decorationLayout });
    paintSurface(side.canvas, { image, text: '', font: engravingFont, spec, layout: decorationLayout });
    for (const t of [front.map, front.bump, side.map, side.bump]) t.needsUpdate = true;
  }, [front, side, image, engravingText, engravingFont, spec, decorationLayout]);

  useEffect(() => {
    paintEngravingMask(engraving.canvas, { text: engravingText, font: engravingFont, spec, layout: decorationLayout });
    engraving.mask.needsUpdate = true;
  }, [engraving, engravingText, engravingFont, spec, decorationLayout]);

  useEffect(() => {
    engraving.uniforms.engravingStrength.value = engravingColor ? 1 : 0;
    if (engravingColor) engraving.uniforms.engravingColor.value.set(engravingColor);
  }, [engraving, engravingColor]);

  const displayScale = fitToView(scale);

  return (
    <mesh
      geometry={geometry}
      material={spec.slots ? materials : materials[0]}
      rotation-y={spec.rotationY}
      scale={displayScale}
      position-y={GROUND_Y - spec.bottomY * displayScale[1]}
      castShadow
    />
  );
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
        console.warn('Could not load 3D model preview', err);
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
