import { t } from '../i18n';

/** Human name of a slicing progress stage reported by the engine. */
export function stageLabel(stage: string): string {
  switch (stage) {
    case 'slicing': return t('Slicing layers');
    case 'perimeters': return t('Generating walls');
    case 'surfaces': return t('Detecting surfaces');
    case 'infill': return t('Generating infill');
    case 'support': return t('Generating supports');
    case 'tower': return t('Planning the wipe tower');
    case 'gcode': return t('Generating G-code and estimating time');
    case 'done': return t('Done');
    default: return stage;
  }
}
