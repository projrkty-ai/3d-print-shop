import type { PlateSlicing, ColorOption, Product, TextureOption } from '../types';

const PLA_COLORS: ColorOption[] = [
  { id: 'white', name: 'Arctic White', hex: '#f4f4f2', priceDelta: 0 },
  { id: 'black', name: 'Matte Black', hex: '#2b2b2e', priceDelta: 0 },
  { id: 'red', name: 'Signal Red', hex: '#d33a2c', priceDelta: 0 },
  { id: 'teal', name: 'Ocean Teal', hex: '#1f8a8a', priceDelta: 0 },
  { id: 'gold', name: 'Silk Gold', hex: '#c9a227', priceDelta: 3 },
  { id: 'marble', name: 'Marble Grey', hex: '#a9a9a4', priceDelta: 2 },
];

/** Fresh copies, so changing one product's colors can't leak into another (or another catalog). */
const plaColors = () => PLA_COLORS.map((color) => ({ ...color }));

/** Bundled shop textures (backend/public/models/textures, made by scripts/generate-demo-textures.mjs). */
const shopTextures = (): TextureOption[] => [
  { id: 'terrazzo', name: 'Terrazzo', url: '/models/textures/terrazzo.png' },
  { id: 'sunset', name: 'Sunset stripes', url: '/models/textures/sunset.png' },
  { id: 'waves', name: 'Ocean waves', url: '/models/textures/waves.png' },
];

const now = '2026-10-01T12:00:00.000Z';

export function createSeedProducts(): Product[] {
  return [
    {
      id: 'twisted-star-vase',
      name: 'Twisted Star Vase',
      description:
        'An eight-pointed star that twists 45° from base to rim. The preview shows the real print file — rotate it to see the facets catch the light.',
      category: 'Home decor',
      material: 'PLA+',
      model: { widthMm: 95.9, depthMm: 95.9, heightMm: 180, volumeCm3: 119.6 },
      basePrice: 29,
      fixedFee: 4,
      productionDays: 3,
      scaling: { enabled: true, minScale: 0.5, maxScale: 1.4 },
      imageUrl: '',
      shape: 'vase',
      mesh: {
        url: '/models/twisted-star-vase.stl',
        format: 'stl',
        fileName: 'twisted-star-vase.stl',
        sizeBytes: 291284,
        triangleCount: 5824,
        parts: [],
        plates: [],
        plate: null,
      },
      published: true,
      colors: plaColors(),
      engraving: {
        enabled: true,
        maxLength: 30,
        maxLines: 2,
        price: 5,
        fonts: ['Georgia', 'Arial', 'Impact'],
        colorChoice: true,
        colorPrice: 3,
      },
      texture: { enabled: false, price: 0 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'tricolor-star-vase',
      name: 'Tricolor Star Vase',
      description:
        'The twisted star vase printed in three colors — base, body and rim. It starts in the designer\'s palette; pick a filament for any part to make it yours.',
      category: 'Home decor',
      material: 'PLA+ (multi-color)',
      model: { widthMm: 95.9, depthMm: 95.9, heightMm: 180, volumeCm3: 119.6 },
      basePrice: 36,
      fixedFee: 6,
      productionDays: 4,
      scaling: { enabled: true, minScale: 0.5, maxScale: 1.4 },
      imageUrl: '',
      shape: 'vase',
      mesh: {
        url: '/models/tricolor-star-vase.3mf',
        format: '3mf',
        fileName: 'tricolor-star-vase.3mf',
        sizeBytes: 59848,
        triangleCount: 5824,
        parts: [
          { key: 'material:Base:#2b2b2e', name: 'Base', fileColor: '#2b2b2e' },
          { key: 'material:Body:#1f8a8a', name: 'Body', fileColor: '#1f8a8a' },
          { key: 'material:Rim:#c9a227', name: 'Rim', fileColor: '#c9a227' },
        ],
        plates: [],
        plate: null,
      },
      published: true,
      colors: plaColors(),
      engraving: {
        enabled: true,
        maxLength: 30,
        maxLines: 2,
        price: 5,
        fonts: ['Georgia', 'Arial', 'Impact'],
        colorChoice: true,
        colorPrice: 0,
      },
      texture: { enabled: false, price: 0 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'spiral-vase',
      name: 'Spiral Vase',
      description:
        'A flowing, single-wall vase printed in one continuous spiral. Watertight with the included liner — perfect for dried or fresh flowers.',
      category: 'Home decor',
      material: 'PLA+',
      model: { widthMm: 110, depthMm: 110, heightMm: 200, volumeCm3: 95 },
      basePrice: 32,
      fixedFee: 5,
      productionDays: 3,
      scaling: { enabled: true, minScale: 0.5, maxScale: 1.3 },
      imageUrl: '',
      shape: 'vase',
      mesh: null,
      published: true,
      colors: plaColors(),
      engraving: {
        enabled: true,
        maxLength: 40,
        maxLines: 2,
        price: 5,
        fonts: ['Georgia', 'Arial', 'Brush Script MT'],
        colorChoice: true,
        colorPrice: 3,
      },
      texture: { enabled: true, price: 7, options: shopTextures(), allowCustom: true },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pen-holder',
      name: 'Desk Pen Holder',
      description:
        'A sturdy cylindrical organizer for pens, brushes and tools. Weighted base keeps it from tipping over.',
      category: 'Office',
      material: 'PETG',
      model: { widthMm: 80, depthMm: 80, heightMm: 100, volumeCm3: 60 },
      basePrice: 14,
      fixedFee: 3,
      productionDays: 2,
      scaling: { enabled: true, minScale: 0.6, maxScale: 1.5 },
      imageUrl: '',
      shape: 'cylinder',
      mesh: null,
      published: true,
      colors: plaColors().slice(0, 4),
      engraving: {
        enabled: true,
        maxLength: 18,
        maxLines: 1,
        price: 4,
        fonts: ['Arial', 'Impact', 'Courier New'],
        colorChoice: false,
        colorPrice: 0,
      },
      texture: { enabled: true, price: 6 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'keepsake-box',
      name: 'Keepsake Box',
      description: 'A lidded cube for jewelry and small treasures. Lid snaps on with a satisfying click.',
      category: 'Gifts',
      material: 'PLA',
      model: { widthMm: 80, depthMm: 80, heightMm: 80, volumeCm3: 70 },
      basePrice: 19,
      fixedFee: 4,
      productionDays: 4,
      scaling: { enabled: false, minScale: 1, maxScale: 1 },
      imageUrl: '',
      shape: 'box',
      mesh: null,
      published: true,
      colors: plaColors(),
      engraving: {
        enabled: true,
        maxLength: 30,
        maxLines: 3,
        price: 4,
        fonts: ['Georgia', 'Trebuchet MS'],
        colorChoice: true,
        colorPrice: 2,
      },
      texture: { enabled: false, price: 0 },
      // Raised 3D lettering lying flat on the lid; customers edit the text and size.
      decorationLayout: {
        extrudedText: {
          x: 0, y: 0, z: 80, rotationDeg: 0, tiltDeg: 90, sizeMm: 9, depthMm: 1.2, lineSpacing: 1.2,
          horizontalAlign: 'center', verticalAlign: 'middle', defaultText: 'With love',
        },
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'moon-lamp',
      name: 'Moon Lamp Shade',
      description:
        'A spherical lamp shade that glows softly when lit. Upload a photo to turn it into a lithophane-style texture.',
      category: 'Lighting',
      material: 'PLA (translucent)',
      model: { widthMm: 150, depthMm: 150, heightMm: 150, volumeCm3: 120 },
      basePrice: 32,
      fixedFee: 6,
      productionDays: 5,
      scaling: { enabled: true, minScale: 0.5, maxScale: 1.5 },
      imageUrl: '',
      shape: 'sphere',
      mesh: null,
      published: false,
      colors: [
        { id: 'natural', name: 'Natural', hex: '#efe9dc', priceDelta: 0 },
        { id: 'warm', name: 'Warm Glow', hex: '#f3d7a4', priceDelta: 2 },
      ],
      engraving: {
        enabled: false,
        maxLength: 10,
        maxLines: 1,
        price: 0,
        fonts: ['Arial'],
        colorChoice: false,
        colorPrice: 0,
      },
      texture: { enabled: true, price: 10 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'star-vase-set',
      name: 'Star Vase Set',
      description:
        'A full-size twisted star vase with two matching 60% minis, printed on two plates and sold as one set. Give each plate its own filament, lettering and texture — the scale applies to the whole set.',
      category: 'Home decor',
      material: 'PLA+',
      // The editor's analysis of the selected plates: the largest extent per axis and the total volume.
      model: { widthMm: 117.6, depthMm: 95.9, heightMm: 180, volumeCm3: 171.2 },
      basePrice: 44,
      fixedFee: 6,
      productionDays: 4,
      scaling: { enabled: true, minScale: 0.6, maxScale: 1.4 },
      imageUrl: '',
      shape: 'vase',
      mesh: {
        url: '/models/star-vase-project.3mf',
        format: '3mf',
        fileName: 'star-vase-project.3mf',
        sizeBytes: 59735,
        triangleCount: 17472,
        parts: [],
        plates: [
          {
            id: 1, name: 'Vase', objectCount: 1, parts: [],
            model: { widthMm: 95.9, depthMm: 95.9, heightMm: 180, volumeCm3: 119.6 },
          },
          {
            id: 2, name: 'Mini vases', objectCount: 2, parts: [],
            model: { widthMm: 117.6, depthMm: 57.6, heightMm: 108, volumeCm3: 51.6 },
            // Each mini is decorated on its own front: picture above, lettering below.
            decorationLayout: {
              text: { centerX: 50, centerY: 25, horizontalAlign: 'center', verticalAlign: 'middle' },
              // About square on a mini's unwrapped surface (≈1.7 × wider than tall).
              texture: { centerX: 50, centerY: 62, width: 24, height: 40 },
            },
          },
        ],
        plate: 1,
        selectedPlates: [1, 2],
      },
      published: true,
      colors: plaColors(),
      engraving: {
        enabled: true,
        maxLength: 24,
        maxLines: 2,
        price: 5,
        fonts: ['Georgia', 'Arial', 'Brush Script MT'],
        colorChoice: true,
        colorPrice: 3,
      },
      texture: { enabled: true, price: 6, options: shopTextures(), allowCustom: true },
      // Both plates sliced with the bundled Snapmaker U1 profiles (slicer/) at 60%, 100% and 140%.
      slicing: [
        demoSlicing(1, [
          [0.4, 0.2, 198, 123.1, [[0.6, 70.2, 30.37], [1.4, 408.6, 269.52]]],
          [0.6, 0.3, 165, 137.95, [[0.6, 37.6, 29.95], [1.4, 415.2, 326.29]]],
        ]),
        demoSlicing(2, [
          [0.4, 0.2, 138.4, 60.69, [[0.6, 32.2, 12.85], [1.4, 298.7, 166.05]]],
          [0.6, 0.3, 74.9, 59.86, [[0.6, 20.7, 12.56], [1.4, 244, 165.66]]],
        ]),
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** [scale, minutes, grams] of a demo variant at another scale. */
type DemoScaled = [number, number, number][];

/** Demo print variants: [nozzle mm, layer height mm, minutes, grams, other scales] sliced in PLA without supports. */
function demoSlicing(plateId: number, variants: [number, number, number, number, DemoScaled][]): PlateSlicing {
  const presetsFor = (nozzle: number, layer: number) => ({
    printer: `Snapmaker U1 (${nozzle} nozzle)`,
    process: `${layer.toFixed(2)} Standard @Snapmaker U1 (${nozzle} nozzle)`,
    filament: `Generic PLA @U1 ${nozzle} nozzle`,
  });
  const all = variants.map(([nozzle, layer]) => presetsFor(nozzle, layer));
  return {
    plateId,
    matrix: {
      printers: [...new Set(all.map((p) => p.printer))],
      processes: [...new Set(all.map((p) => p.process))],
      filaments: [...new Set(all.map((p) => p.filament))],
    },
    support: false,
    overrides: {},
    variants: variants.map(([nozzle, layer, printMinutes, grams, scaled]) => {
      const measure = (minutes: number, weight: number) => ({ printMinutes: minutes, filaments: [{ material: 'PLA' as const, grams: weight }] });
      const measurements = measure(printMinutes, grams);
      return {
        id: `n${nozzle * 10}-l${Math.round(layer * 100)}`,
        label: layer < 0.25 ? `Fine: ${layer.toFixed(2)} mm layers, ${nozzle} mm nozzle` : `Fast: ${layer.toFixed(2)} mm layers, ${nozzle} mm nozzle`,
        presets: presetsFor(nozzle, layer),
        nozzleMm: nozzle,
        layerHeightMm: layer,
        material: 'PLA' as const,
        measurements,
        sliced: { ...measurements, slicedAt: now },
        scaled: scaled.map(([scale, minutes, weight]) => ({
          scale, measurements: measure(minutes, weight), sliced: { ...measure(minutes, weight), slicedAt: now },
        })),
        enabled: true,
      };
    }),
    defaultVariantId: 'n4-l20',
  };
}
