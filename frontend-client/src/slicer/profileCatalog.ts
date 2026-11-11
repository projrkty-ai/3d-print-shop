import type { ProfilePreset } from './engine/index.mjs';

/**
 * Printer / process / filament choices of the bundled OrcaSlicer presets. Presets inherit
 * settings through `inherits`; only instantiable presets (`instantiation` not "false") are
 * offered, like in OrcaSlicer's preset combos.
 */
export interface ProfileCatalog {
  printers: string[];
  processesFor(printer: string): string[];
  filamentsFor(printer: string): string[];
  defaultProcess(printer: string): string | undefined;
  defaultFilament(printer: string): string | undefined;
  /** A setting of a preset, resolved through its `inherits` chain (arrays are per extruder). */
  setting(preset: string, key: string): unknown;
}

export function buildCatalog(presets: ProfilePreset[]): ProfileCatalog {
  const byName = new Map(presets.map((p) => [p.name, p]));
  const resolved = new Map<string, ProfilePreset>();
  const resolve = (name: string, depth = 0): ProfilePreset | undefined => {
    const cached = resolved.get(name);
    if (cached) return cached;
    const preset = byName.get(name);
    if (!preset || depth > 32) return undefined;
    const base = preset.inherits ? resolve(preset.inherits, depth + 1) : undefined;
    const merged = { ...(base ?? {}), ...preset } as ProfilePreset;
    resolved.set(name, merged);
    return merged;
  };
  const instantiable = (type: string) =>
    presets.filter((p) => p.type === type && p.instantiation !== 'false').map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const compatible = (name: string, printer: string): boolean => {
    const list = resolve(name)?.compatible_printers;
    return !Array.isArray(list) || list.length === 0 || list.includes(printer);
  };
  const printers = instantiable('machine');
  const processes = instantiable('process');
  const filaments = instantiable('filament');
  const explicitlyFor = (name: string, printer: string) => {
    const list = resolve(name)?.compatible_printers;
    return Array.isArray(list) && list.includes(printer);
  };

  return {
    printers,
    processesFor: (printer) => processes.filter((p) => compatible(p, printer)),
    filamentsFor: (printer) => {
      const ok = filaments.filter((f) => compatible(f, printer));
      // presets made for this printer first (as the engine's default choice)
      return [...ok.filter((f) => explicitlyFor(f, printer)), ...ok.filter((f) => !explicitlyFor(f, printer))];
    },
    defaultProcess: (printer) => {
      const preferred = resolve(printer)?.default_print_profile;
      const list = processes.filter((p) => compatible(p, printer));
      return typeof preferred === 'string' && list.includes(preferred) ? preferred : list[0];
    },
    defaultFilament: (printer) => {
      const list = filaments.filter((f) => compatible(f, printer));
      return list.find((f) => explicitlyFor(f, printer)) ?? list[0];
    },
    setting: (preset, key) => resolve(preset)?.[key],
  };
}
