import { estimate, loadModelBytes, ProfileLibrary, type CalibrationData, type LoadedModel, type ProfilePreset } from './engine/index.mjs';
import profiles from './engine/profiles.json';
import calibration from './engine/calibration.json';
import type { ModelInfo, SliceSettings } from './protocol';

let library: ProfileLibrary | null = null;
const getLibrary = () => (library ??= new ProfileLibrary(profiles as ProfilePreset[]));

export function inspectModel(model: LoadedModel, fileName: string): ModelInfo {
  const project = model.projectConfig;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    fileName,
    objects: model.objects.map((o) => ({ name: o.name, extruder: o.extruder })),
    plates: model.plates ?? [],
    hasProjectSettings: !!project,
    projectPrinter: project ? str(project.printer_settings_id) : undefined,
    projectProcess: project ? str(project.print_settings_id) : undefined,
    painted: model.objects.some((o) => o.volumes.some((v) => !!(v as { paint?: unknown }).paint)),
  };
}

export function loadModel(file: ArrayBuffer, fileName: string, plate = 1): LoadedModel {
  return loadModelBytes(new Uint8Array(file), fileName, { plate });
}

export function runSlice(file: ArrayBuffer, fileName: string, settings: SliceSettings, onProgress: (stage: string, fraction: number) => void) {
  const model = loadModel(file, fileName, settings.plate || 1);
  const presets = settings.useProjectSettings && model.projectConfig
    ? {}
    : { printer: settings.printer, process: settings.process, filament: settings.filament || undefined };
  return estimate({
    model,
    library: getLibrary(),
    ...presets,
    support: settings.support === 'profile' ? null : settings.support === 'on',
    calibration: settings.calibration ? (calibration as unknown as CalibrationData) : null,
    overrides: settings.overrides,
    copies: settings.copies,
    scale: settings.scale ?? 1,
    gcode: settings.gcode,
    modelName: fileName,
    onProgress,
  });
}
