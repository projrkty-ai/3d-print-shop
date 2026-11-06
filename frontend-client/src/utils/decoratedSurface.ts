import * as THREE from 'three';
import type { DecorationLayout } from '../types';
import type { SurfaceSpec } from './mesh';
import { CANVAS_H, CANVAS_W, paintEngravingMask, paintRelief, paintSurface, paintTextureColors } from './surfacePainting';

export interface SurfaceDecoration {
  /** Loaded picture texture, or null for none. */
  image: (CanvasImageSource & { naturalWidth: number; naturalHeight: number }) | null;
  text: string;
  font: string;
  layout?: DecorationLayout;
}

function canvasTexture(colorSpace: THREE.ColorSpace = THREE.NoColorSpace) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.anisotropy = 8;
  // Model-file UVs may exceed 1 where triangles cross the seam at the back; wrap instead of clamping.
  texture.wrapS = THREE.RepeatWrapping;
  return { canvas, texture };
}

/** Color map (lettering shading), relief (bump) and full-color picture overlay of one slot kind. */
function surfaceLayers() {
  return { color: canvasTexture(THREE.SRGBColorSpace), relief: canvasTexture(), picture: canvasTexture(THREE.SRGBColorSpace) };
}
type SurfaceLayers = ReturnType<typeof surfaceLayers>;

type DecorationUniforms = {
  pictureColors: { value: THREE.Texture };
  engravingMask: { value: THREE.Texture };
  engravingColor: { value: THREE.Color };
  engravingStrength: { value: number };
};

/**
 * Lays the full-color picture over the filament color, shades engraved letters, optionally fills
 * them with their own filament, and applies the relief — on the outside only. Back faces (e.g. the
 * inside of an open vase) stay plain, so decorations never show through the model.
 */
function decorate(material: THREE.MeshStandardMaterial, uniforms: DecorationUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D pictureColors;
        uniform sampler2D engravingMask;
        uniform vec3 engravingColor;
        uniform float engravingStrength;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          float decorated = gl_FrontFacing ? 1.0 : 0.0;
          vec4 picture = texture2D(pictureColors, vMapUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, picture.rgb, picture.a * decorated);
          diffuseColor *= mix(vec4(1.0), texture2D(map, vMapUv), decorated);
          diffuseColor.rgb = mix(diffuseColor.rgb, engravingColor, texture2D(engravingMask, vMapUv).r * engravingStrength * decorated);
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 undecoratedNormal = normal;
        #include <normal_fragment_maps>
        normal = gl_FrontFacing ? normal : undecoratedNormal;`,
      );
  };
  // Keep these programs apart from plain materials with otherwise identical settings.
  material.customProgramCacheKey = () => 'decorated-surface';
}

/**
 * Materials for one model surface with engraving and picture texture, independent of React so the
 * live preview and off-screen thumbnails render decorations identically. Front slots carry text and
 * picture, side slots (box faces) the picture only, plain slots (tops, bottoms, inner walls) neither.
 */
export class DecoratedSurface {
  readonly materials: THREE.MeshStandardMaterial[];
  private readonly front: SurfaceLayers = surfaceLayers();
  private readonly side: SurfaceLayers = surfaceLayers();
  private readonly mask = canvasTexture();
  private readonly engravingColor = new THREE.Color();
  private readonly frontUniforms: DecorationUniforms;

  constructor(readonly spec: SurfaceSpec) {
    this.frontUniforms = {
      pictureColors: { value: this.front.picture.texture },
      engravingMask: { value: this.mask.texture },
      engravingColor: { value: this.engravingColor },
      engravingStrength: { value: 0 },
    };
    const sideUniforms: DecorationUniforms = {
      pictureColors: { value: this.side.picture.texture },
      engravingMask: { value: this.mask.texture },
      engravingColor: { value: this.engravingColor },
      engravingStrength: { value: 0 },
    };
    const make = (layers?: SurfaceLayers) => new THREE.MeshStandardMaterial({
      roughness: 0.55,
      metalness: 0.05,
      map: layers?.color.texture ?? null,
      bumpMap: layers?.relief.texture ?? null,
      bumpScale: 4,
      side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.materials = (spec.slots ?? ['front']).map((slot) => {
      if (slot === 'plain') return make();
      const material = make(slot === 'front' ? this.front : this.side);
      decorate(material, slot === 'front' ? this.frontUniforms : sideUniforms);
      return material;
    });
  }

  /** `colors` holds the filament color of each part, indexed by `spec.slotParts`. */
  setColors(colors: string[]) {
    this.materials.forEach((material, i) => {
      material.color.set(colors[this.spec.slotParts?.[i] ?? 0] ?? colors[0]);
    });
  }

  /** Filament for the engraved letters; null leaves them as grooves in the print color. */
  setEngravingColor(color: string | null) {
    this.frontUniforms.engravingStrength.value = color ? 1 : 0;
    if (color) this.engravingColor.set(color);
  }

  paint({ image, text, font, layout }: SurfaceDecoration) {
    const { spec } = this;
    paintSurface(this.front.color.canvas, { text, font, spec, layout });
    paintRelief(this.front.relief.canvas, { image, text, font, spec, layout });
    paintTextureColors(this.front.picture.canvas, { image, spec, layout });
    paintSurface(this.side.color.canvas, { text: '', font, spec, layout });
    paintRelief(this.side.relief.canvas, { image, text: '', font, spec, layout });
    paintTextureColors(this.side.picture.canvas, { image, spec, layout });
    paintEngravingMask(this.mask.canvas, { text, font, spec, layout });
    for (const layers of [this.front, this.side]) {
      for (const layer of [layers.color, layers.relief, layers.picture]) layer.texture.needsUpdate = true;
    }
    this.mask.texture.needsUpdate = true;
  }

  dispose() {
    this.materials.forEach((material) => material.dispose());
    for (const layers of [this.front, this.side]) {
      for (const layer of [layers.color, layers.relief, layers.picture]) layer.texture.dispose();
    }
    this.mask.texture.dispose();
  }
}

/** Loads a picture for painting; shop textures may come from a separately hosted API, so ask for CORS. */
export function loadPicture(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!/^(?:data|blob):/i.test(src)) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load the texture picture ${src.slice(0, 80)}`));
    image.src = src;
  });
}
