import { formatCount, t } from '../../i18n';
import { NavLink } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { PrinterModel, PrinterModelInput, PrinterProfiles } from '../../types';
import { formatDimensions } from '../../utils/sizing';
import { formatBytes } from './orderDisplay';

/** Switches between the two parts of the printers warehouse. */
export function PrintersNav() {
  return (
    <nav className="printers-nav" aria-label={t("Printers warehouse")}>
      {/* Also active on a printer's queue. */}
      <NavLink to="/admin/printers" className={({ isActive }) => (isActive ? 'is-active' : '')}>{t("Printers")}</NavLink>
      <NavLink to="/admin/printer-models" className={({ isActive }) => (isActive ? 'is-active' : '')}>{t("Printer models")}</NavLink>
    </nav>
  );
}

/** "presets: 2 printer, 3 process, 4 filament", or the number of files when the archive has no presets. */
export function presetSummary(profiles: PrinterProfiles): string {
  const { machine, process, filament } = profiles.presets;
  if (machine.length + process.length + filament.length === 0) return formatCount('file', profiles.entries.length);
  return t("presets: {0} printer, {1} process, {2} filament", machine.length, process.length, filament.length);
}

/** "Snapmaker U1 — 270 × 270 × 270 mm, 4 colors" */
export const modelLabel = (model: PrinterModelInput) => `${model.name} — ${formatDimensions(model.plate)}, ${formatCount('color', model.maxColors)}`;

/** Saves the model's profile archive in the browser's downloads; resolves with an error message on failure. */
export async function downloadProfiles(model: PrinterModel): Promise<string | null> {
  if (!model.profiles) return null;
  try {
    const url = URL.createObjectURL(await api.downloadPrinterModelProfiles(model.id));
    const link = document.createElement('a');
    link.href = url;
    link.download = model.profiles.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.message : t("Could not download the profiles.");
  }
}

/** The profile archive's name (a download link), size and presets. */
export function ProfilesCell({ model, onDownload }: { model: PrinterModel; onDownload: () => void }) {
  if (!model.profiles) return <span className="muted">{t("None")}</span>;
  return (
    <div className="printers__profiles">
      <button type="button" className="link-button" onClick={onDownload} title={t("Download the profiles")}>{model.profiles.fileName}</button>
      <div className="muted">{formatBytes(model.profiles.sizeBytes)} · {presetSummary(model.profiles)}</div>
    </div>
  );
}

/** The files and presets of an archive, folded away by default. */
export function ProfileContents({ profiles }: { profiles: PrinterProfiles }) {
  if (profiles.entries.length === 0) return null;
  const presets = [
    [t("Printer presets"), profiles.presets.machine],
    [t("Process presets"), profiles.presets.process],
    [t("Filament presets"), profiles.presets.filament],
  ] as const;
  return (
    <details className="printer-editor__contents">
      <summary>{t("Archive contents")}</summary>
      {presets.filter(([, names]) => names.length > 0).map(([label, names]) => (
        <p key={label}><strong>{label}:</strong> {names.join(', ')}</p>
      ))}
      <ul>
        {profiles.entries.map((entry) => (
          <li key={entry.name}>{entry.name} <span className="muted">({formatBytes(entry.sizeBytes)})</span></li>
        ))}
      </ul>
    </details>
  );
}
