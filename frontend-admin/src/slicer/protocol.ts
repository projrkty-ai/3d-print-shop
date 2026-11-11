import type { EstimateResult } from './engine/index.mjs';

export type SupportChoice = 'profile' | 'on' | 'off';

/** Settings of one slicing run chosen in the admin form. */
export interface SliceSettings {
  /** use the printer/process/filament settings stored in the 3MF project instead of presets */
  useProjectSettings: boolean;
  printer: string;
  process: string;
  filament: string;
  support: SupportChoice;
  plate: number;
  copies: number;
  /** uniform scale of the plate (1 = original size); omitted = 1 */
  scale?: number;
  calibration: boolean;
  overrides: Record<string, string>;
  gcode: boolean;
}

export interface ModelInfo {
  fileName: string;
  objects: { name: string; extruder: number }[];
  plates: { id: number; name: string; instances: number }[];
  hasProjectSettings: boolean;
  projectPrinter?: string;
  projectProcess?: string;
  painted: boolean;
}

export type WorkerRequest =
  | { id: number; type: 'inspect'; file: ArrayBuffer; fileName: string; plate: number }
  | { id: number; type: 'slice'; file: ArrayBuffer; fileName: string; settings: SliceSettings };

export type WorkerResponse =
  | { id: number; type: 'inspected'; info: ModelInfo }
  | { id: number; type: 'progress'; stage: string; fraction: number }
  | { id: number; type: 'result'; result: EstimateResult; gcode?: string }
  | { id: number; type: 'error'; message: string };
