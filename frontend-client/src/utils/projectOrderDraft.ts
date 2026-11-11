import { MAX_QUANTITY } from '../config';
import {
  MAX_FILAMENTS, PROJECT_MATERIALS, type FilamentChoice, type ModelSource, type ProjectMaterial, type ProjectPrintSettings,
  type ProjectRef,
} from '../types';

export const SCALE_PERCENT = { min: 10, max: 500 } as const;
export const COLOR_MAX_LENGTH = 60;
const SOURCES: readonly ModelSource[] = ['thingiverse', 'printables', 'makerworld'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What the customer has chosen so far; kept in the browser across searches and reloads (contact details are not). */
export interface ProjectOrderDraft {
  ref: ProjectRef | null;
  /** Chosen file ids; null means every model the project lists. */
  fileIds: string[] | null;
  /** One selection for all models (`shared`) or separate settings per model (`perModel`, by file id). */
  sameForAll: boolean;
  shared: ProjectPrintSettings;
  perModel: Record<string, ProjectPrintSettings>;
  notes: string;
}

export const defaultFilament = (): FilamentChoice => ({ material: 'any', color: '' });
export const defaultSettings = (): ProjectPrintSettings => ({ quantity: 1, scalePercent: 100, filaments: [defaultFilament()] });
export const emptyDraft = (): ProjectOrderDraft => ({ ref: null, fileIds: null, sameForAll: true, shared: defaultSettings(), perModel: {}, notes: '' });

/** The same project with fresh order settings, e.g. after an order was sent. */
export const resetOrder = (draft: ProjectOrderDraft): ProjectOrderDraft => ({ ...emptyDraft(), ref: draft.ref });

export const sameRef = (a: ProjectRef | null | undefined, b: ProjectRef | null | undefined) =>
  a?.source === b?.source && a?.id === b?.id;

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

function toSettings(value: unknown): ProjectPrintSettings {
  if (typeof value !== 'object' || value === null) return defaultSettings();
  const v = value as Record<string, unknown>;
  const filaments = (Array.isArray(v.filaments) ? v.filaments : []).slice(0, MAX_FILAMENTS).flatMap((item): FilamentChoice[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { material, color } = item as Record<string, unknown>;
    return [{
      material: (PROJECT_MATERIALS as readonly string[]).includes(String(material)) ? (material as ProjectMaterial) : 'any',
      color: typeof color === 'string' ? color.slice(0, COLOR_MAX_LENGTH) : '',
    }];
  });
  return {
    quantity: clampInt(v.quantity, 1, MAX_QUANTITY, 1),
    scalePercent: clampInt(v.scalePercent, SCALE_PERCENT.min, SCALE_PERCENT.max, 100),
    filaments: filaments.length > 0 ? filaments : [defaultFilament()],
  };
}

export function isDraftLike(value: unknown): value is ProjectOrderDraft {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Repairs a draft restored from the browser: stale, hand-edited or saved by an older version (which kept
 * one `preferences` object). Anything unusable falls back to defaults instead of breaking the page.
 */
export function normalizeDraft(value: ProjectOrderDraft | Record<string, unknown>): ProjectOrderDraft {
  const v = value as Record<string, unknown>;
  const ref = v.ref as Partial<ProjectRef> | null | undefined;
  const validRef = ref && typeof ref === 'object' && SOURCES.includes(ref.source as ModelSource) && ID.test(String(ref.id))
    ? { source: ref.source as ModelSource, id: String(ref.id) } : null;
  const fileIds = Array.isArray(v.fileIds) ? v.fileIds.filter((id): id is string => typeof id === 'string' && ID.test(id)) : null;
  const legacy = typeof v.preferences === 'object' && v.preferences !== null ? v.preferences as Record<string, unknown> : null;
  const shared = legacy
    ? toSettings({ ...legacy, filaments: [{ material: legacy.material, color: legacy.color }] })
    : toSettings(v.shared);
  const perModel: Record<string, ProjectPrintSettings> = {};
  if (typeof v.perModel === 'object' && v.perModel !== null) {
    for (const [id, settings] of Object.entries(v.perModel)) if (ID.test(id)) perModel[id] = toSettings(settings);
  }
  const notes = typeof v.notes === 'string' ? v.notes : typeof legacy?.notes === 'string' ? legacy.notes : '';
  return { ref: validRef, fileIds, sameForAll: v.sameForAll !== false, shared, perModel, notes: notes.slice(0, 2000) };
}
