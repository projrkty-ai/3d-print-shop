import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PrintSettings } from '../types';
import { partShares } from './customModel';
import { PART_ATTRIBUTE } from './mesh';
import {
  estimateOptions, estimatePrint, layerFitsNozzle, layersForNozzle, nearestColor, resolveOptions, SINGLE_PART_KEY, type ModelPart,
} from './printOptions';

const settings: PrintSettings = {
  nozzles: [
    { id: 'n04', diameterMm: 0.4, priceMultiplier: 1 },
    { id: 'n08', diameterMm: 0.8, priceMultiplier: 0.8 },
  ],
  defaultNozzleId: 'n04',
  layerHeights: [
    { id: 'l012', heightMm: 0.12, priceMultiplier: 1.5 },
    { id: 'l02', heightMm: 0.2, priceMultiplier: 1 },
    { id: 'l028', heightMm: 0.28, priceMultiplier: 0.8 },
    { id: 'l048', heightMm: 0.48, priceMultiplier: 0.6 },
  ],
  defaultLayerHeightId: 'l02',
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

describe('print options', () => {
  it("defaults to the default nozzle and layer height, the first filament and the color nearest the part's own", () => {
    expect(resolveOptions(single, null, settings)).toEqual({ nozzleId: 'n04', layerHeightId: 'l02', parts: pla });
    expect(resolveOptions(twoColors, null, settings).parts).toEqual({
      body: { filamentId: 'pla', colorId: 'red' }, rim: { filamentId: 'pla', colorId: 'white' },
    });
    expect(nearestColor('#000000', settings.filaments[0].colors).id).toBe('black');
    expect(nearestColor('not a color', settings.filaments[0].colors).id).toBe('black');
  });

  it('offers only layer heights from a quarter to 0.8 × the nozzle diameter', () => {
    expect([0.09, 0.1, 0.32, 0.33].map((h) => layerFitsNozzle(h, 0.4))).toEqual([false, true, true, false]);
    expect(layersForNozzle(settings, settings.nozzles[0]).map((l) => l.heightMm)).toEqual([0.12, 0.2, 0.28]);
    expect(layersForNozzle(settings, settings.nozzles[1]).map((l) => l.heightMm)).toEqual([0.2, 0.28, 0.48]);
  });

  it('keeps a layer height the new nozzle can print, and otherwise picks the closest one it can', () => {
    expect(resolveOptions(single, { nozzleId: 'n08', layerHeightId: 'l028', parts: pla }, settings).layerHeightId).toBe('l028');
    // 0.12 mm is too thin for a 0.8 mm nozzle (0.2–0.64 mm): the closest is 0.2 mm.
    expect(resolveOptions(single, { nozzleId: 'n08', layerHeightId: 'l012', parts: pla }, settings).layerHeightId).toBe('l02');
    // 0.48 mm is too thick for 0.4 mm (0.1–0.32 mm): the closest is 0.28 mm.
    expect(resolveOptions(single, { nozzleId: 'n04', layerHeightId: 'l048', parts: pla }, settings).layerHeightId).toBe('l028');
  });

  it('keeps choices that are still offered and replaces withdrawn ones', () => {
    const chosen = { nozzleId: 'n08', layerHeightId: 'l048', parts: { body: { filamentId: 'silk', colorId: 'gold' }, rim: { filamentId: 'pla', colorId: 'red' } } };
    expect(resolveOptions(twoColors, chosen, settings)).toEqual(chosen);
    const withdrawn = { nozzleId: 'n10', layerHeightId: 'l09', parts: { body: { filamentId: 'nylon', colorId: 'gold' }, rim: { filamentId: 'pla', colorId: 'pink' } } };
    expect(resolveOptions(twoColors, withdrawn, settings)).toEqual({
      nozzleId: 'n04', layerHeightId: 'l02', parts: { body: { filamentId: 'pla', colorId: 'red' }, rim: { filamentId: 'pla', colorId: 'white' } },
    });
  });

  it('estimates only a price, from volume, density, price per kilogram, part shares, nozzle and layer height', () => {
    // 100 cm³ × 1.25 g/cm³ = 0.125 kg of PLA at $80/kg = $10.00.
    expect(estimatePrint(100, single, 1, () => settings.filaments[0])).toEqual({ unitPrice: 10 });
    // 0.8 mm nozzle (× 0.8) with 0.48 mm layers (× 0.6).
    expect(estimateOptions(100, single, { nozzleId: 'n08', layerHeightId: 'l048', parts: pla }, settings)).toEqual({ unitPrice: 4.8 });
    // 75 % PLA ($7.50) + 25 % Silk (0.03125 kg × $200 = $6.25).
    const mixed = { nozzleId: 'n04', layerHeightId: 'l02', parts: { body: { filamentId: 'pla', colorId: 'red' }, rim: { filamentId: 'silk', colorId: 'gold' } } };
    expect(estimateOptions(100, twoColors, mixed, settings)).toEqual({ unitPrice: 13.75 });
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
