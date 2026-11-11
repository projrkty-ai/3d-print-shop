import { describe, expect, it } from 'vitest';
import profiles from './engine/profiles.json';
import type { ProfilePreset } from './engine/index.mjs';
import { buildCatalog } from './profileCatalog';

const catalog = buildCatalog(profiles as ProfilePreset[]);

describe('bundled profile catalog', () => {
  it('lists the Snapmaker U1 printers with their compatible processes and filaments', () => {
    expect(catalog.printers).toContain('Snapmaker U1 (0.4 nozzle)');
    expect(catalog.printers).not.toContain('fdm_U1');
    expect(catalog.processesFor('Snapmaker U1 (0.4 nozzle)')).toEqual(['0.20 Standard @Snapmaker U1 (0.4 nozzle)']);
    expect(catalog.processesFor('Snapmaker U1 (0.6 nozzle)')).toEqual([
      '0.20 Standard @Snapmaker U1 (0.6 nozzle)',
      '0.30 Standard @Snapmaker U1 (0.6 nozzle)',
    ]);
    expect(catalog.defaultFilament('Snapmaker U1 (0.8 nozzle)')).toBe('Generic PLA @U1 0.8 nozzle');
    expect(catalog.filamentsFor('Snapmaker U1 (0.8 nozzle)')[0]).toBe('Generic PLA @U1 0.8 nozzle');
    expect(catalog.defaultProcess('Snapmaker U1 (0.2 nozzle)')).toBe('0.10 Standard @Snapmaker U1 (0.2 nozzle)');
  });
});
