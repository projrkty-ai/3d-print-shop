import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PrintSettings } from '../types';
import { partShares } from './customModel';
import { partGrams } from './customSlicing';
import { PART_ATTRIBUTE } from './mesh';
import { nearestColor, offeredPresets, profileFacts, resolveOptions, resolveProfile, SINGLE_PART_KEY, type ModelPart } from './printOptions';

const U1_04 = 'Snapmaker U1 (0.4 nozzle)';
const U1_06 = 'Snapmaker U1 (0.6 nozzle)';
const settings: PrintSettings = {
  profiles: {
    printers: [U1_04, U1_06, 'Snapmaker U1 (0.8 nozzle)'],
    processes: ['0.20 Standard @Snapmaker U1 (0.4 nozzle)', '0.20 Standard @Snapmaker U1 (0.6 nozzle)', '0.30 Standard @Snapmaker U1 (0.6 nozzle)'],
    filaments: ['Generic PLA @U1 0.4 nozzle', 'Generic PLA @System'],
  },
  nozzles: [],
  defaultNozzleId: '',
  layerHeights: [],
  defaultLayerHeightId: '',
  filaments: [
    {
      id: 'pla', name: 'PLA', description: '', pricePerKg: 80, densityGPerCm3: 1.25,
      colors: [{ id: 'black', name: 'Black', hex: '#111111' }, { id: 'red', name: 'Red', hex: '#cc2222' }, { id: 'white', name: 'White', hex: '#f5f5f5' }],
    },
    { id: 'silk', name: 'Silk', description: '', pricePerKg: 200, densityGPerCm3: 1.25, colors: [{ id: 'gold', name: 'Gold', hex: '#c9a227' }] },
  ],
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const single: ModelPart[] = [{ key: SINGLE_PART_KEY, name: 'Model', fileColor: null, share: 1 }];
const twoColors: ModelPart[] = [
  { key: 'body', name: 'Body', fileColor: '#ee3333', share: 0.75 },
  { key: 'rim', name: 'Rim', fileColor: '#fafafa', share: 0.25 },
];
const pla = { model: { filamentId: 'pla', colorId: 'black' } };
const defaultProfile = {
  printer: U1_04, process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle', support: false, scale: 1,
};

describe('print options', () => {
  it("defaults to the 0.4 mm printer's default process and filament, the first filament type and the color nearest the part's own", () => {
    expect(resolveOptions(single, null, settings)).toEqual({ profile: defaultProfile, parts: pla });
    expect(resolveOptions(twoColors, null, settings)!.parts).toEqual({
      body: { filamentId: 'pla', colorId: 'red' }, rim: { filamentId: 'pla', colorId: 'white' },
    });
    expect(nearestColor('#000000', settings.filaments[0].colors).id).toBe('black');
    expect(nearestColor('not a color', settings.filaments[0].colors).id).toBe('black');
    expect(profileFacts(defaultProfile)).toEqual({ nozzleMm: 0.4, layerHeightMm: 0.2 });
  });

  it('offers only presets the shop offers and made for the printer, and printers that have both', () => {
    const offered = offeredPresets(settings);
    // the 0.8 mm printer has no offered process
    expect(offered.printers).toEqual([U1_04, U1_06]);
    expect(offered.processesFor(U1_06)).toEqual(['0.20 Standard @Snapmaker U1 (0.6 nozzle)', '0.30 Standard @Snapmaker U1 (0.6 nozzle)']);
    expect(offered.filamentsFor(U1_06)).toEqual(['Generic PLA @System']);
    // older servers without the setting: every bundled preset
    expect(offeredPresets({ ...settings, profiles: undefined }).printers).toHaveLength(5);
    expect(resolveProfile(null, { ...settings, profiles: { printers: [], processes: [], filaments: [] } })).toBeNull();
  });

  it('keeps choices that are still offered and replaces withdrawn ones', () => {
    const chosen = {
      profile: { printer: U1_06, process: '0.30 Standard @Snapmaker U1 (0.6 nozzle)', filament: 'Generic PLA @System', support: true, scale: 1.5 },
      parts: { body: { filamentId: 'silk', colorId: 'gold' }, rim: { filamentId: 'pla', colorId: 'red' } },
    };
    expect(resolveOptions(twoColors, chosen, settings)).toEqual(chosen);
    // another printer takes its own default process, and keeps the filament made for both
    expect(resolveOptions(twoColors, { ...chosen, profile: { ...chosen.profile, printer: U1_04 } }, settings)!.profile)
      .toEqual({ ...defaultProfile, filament: 'Generic PLA @System', support: true, scale: 1.5 });
    const withdrawn = {
      profile: { ...chosen.profile, printer: 'Gone', scale: 50 },
      parts: { body: { filamentId: 'nylon', colorId: 'gold' }, rim: { filamentId: 'pla', colorId: 'pink' } },
    };
    expect(resolveOptions(twoColors, withdrawn, settings)).toEqual({
      profile: { ...defaultProfile, filament: 'Generic PLA @System', support: true, scale: 10 },
      parts: { body: { filamentId: 'pla', colorId: 'red' }, rim: { filamentId: 'pla', colorId: 'white' } },
    });
  });

  it('gives every color part its filament: per extruder for slicer projects, else by share', () => {
    const perExtruder = [{ extruder: 1, weight_g: 10, length_m: 0 }, { extruder: 2, weight_g: 4, length_m: 0 }, { extruder: 3, weight_g: 1, length_m: 0 }];
    const project = [
      { key: 'filament:1', name: 'Red', fileColor: '#ff0000', share: 0.5 },
      { key: 'filament:2', name: 'White', fileColor: '#ffffff', share: 0.5 },
    ];
    // extruder 3 has no part of its own: its filament goes to the first part
    expect(partGrams(project, perExtruder, 15)).toEqual([{ key: 'filament:1', grams: 11 }, { key: 'filament:2', grams: 4 }]);
    expect(partGrams(single, perExtruder, 15)).toEqual([{ key: 'model', grams: 15 }]);
    expect(partGrams(twoColors, perExtruder, 15)).toEqual([{ key: 'body', grams: 11.25 }, { key: 'rim', grams: 3.75 }]);
  });

  it('splits multi-color models by the surface area of each part', () => {
    // Two triangles of part 0 with area 0.5 each and one of part 1 with area 2.
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute(PART_ATTRIBUTE, new THREE.BufferAttribute(new Uint8Array([0, 0, 0, 0, 0, 0, 1, 1, 1]), 1));
    const parts = [{ key: 'a', name: 'A', color: '#000000' }, { key: 'b', name: 'B', color: '#ffffff' }];
    expect(partShares(geometry, parts)).toEqual([1 / 3, 2 / 3]);
    geometry.deleteAttribute(PART_ATTRIBUTE);
    expect(partShares(geometry, parts)).toEqual([0.5, 0.5]);
  });
});
