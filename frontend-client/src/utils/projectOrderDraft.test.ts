import { describe, expect, it } from 'vitest';
import { emptyDraft, normalizeDraft, resetOrder } from './projectOrderDraft';

describe('project order drafts', () => {
  it('upgrades a draft saved before per-model settings, keeping the project and the customer’s choices', () => {
    const legacy = {
      ref: { source: 'printables', id: '12345' }, fileIds: ['9'],
      preferences: { quantity: 3, material: 'PETG', color: 'black', scalePercent: 150, notes: 'Old note' },
    };
    expect(normalizeDraft(legacy)).toEqual({
      ref: { source: 'printables', id: '12345' }, fileIds: ['9'], sameForAll: true, perModel: {}, notes: 'Old note',
      shared: { quantity: 3, scalePercent: 150, filaments: [{ material: 'PETG', color: 'black' }] },
    });
  });

  it('repairs hand-edited or stale data instead of failing', () => {
    const draft = normalizeDraft({
      ref: { source: 'cults3d', id: '1' }, fileIds: ['ok', '../bad', 7], sameForAll: false, notes: 42,
      shared: { quantity: 99, scalePercent: 1, filaments: [{ material: 'wood', color: 'x'.repeat(100) }, null] },
      perModel: { ok: { quantity: 2 }, '../bad': {} },
    });
    expect(draft).toEqual({
      ref: null, fileIds: ['ok'], sameForAll: false, notes: '',
      shared: { quantity: 20, scalePercent: 10, filaments: [{ material: 'any', color: 'x'.repeat(60) }] },
      perModel: { ok: { quantity: 2, scalePercent: 100, filaments: [{ material: 'any', color: '' }] } },
    });
    expect(normalizeDraft({})).toEqual(emptyDraft());
  });

  it('starts a fresh order for the same project', () => {
    const draft = { ...emptyDraft(), ref: { source: 'makerworld' as const, id: '7' }, notes: 'x', sameForAll: false, fileIds: [] };
    expect(resetOrder(draft)).toEqual({ ...emptyDraft(), ref: { source: 'makerworld', id: '7' } });
  });
});
