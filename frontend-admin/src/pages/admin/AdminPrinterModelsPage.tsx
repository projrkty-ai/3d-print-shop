import { formatNumber, t } from '../../i18n';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { PrinterModelWithPrinters } from '../../types';
import { formatDimensions } from '../../utils/sizing';
import { downloadProfiles, PrintersNav, ProfilesCell } from './printerDisplay';
import { useAdminData } from './useAdminData';

type Banner = { kind: 'success' | 'error'; text: string };

export const modelPath = (id: string) => `/admin/printer-models/${encodeURIComponent(id)}`;

/** The printer models of the warehouse: plate size, colors and profiles shared by all printers of each model. */
export function AdminPrinterModelsPage() {
  const { state, setData, reload } = useAdminData(() => api.listPrinterModels(), []);
  // A message from the model editor, e.g. after deleting a model there.
  const location = useLocation();
  const [banner, setBanner] = useState<Banner | null>((location.state as { banner?: Banner } | null)?.banner ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <PrintersNav />
        <h1>{t("Printer models")}</h1>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading printer models…")} />
      </div>
    );
  }
  const models = state.data;

  async function remove(model: PrinterModelWithPrinters) {
    if (!window.confirm(t("Delete printer model \"{0}\"? Its uploaded profiles are deleted too. This cannot be undone.", model.name))) return;
    setBusyId(model.id);
    setBanner(null);
    try {
      await api.deletePrinterModel(model.id);
      setData(models.filter((m) => m.id !== model.id));
      setBanner({ kind: 'success', text: t("Deleted printer model \"{0}\".", model.name) });
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof ApiError ? err.message : t("Something went wrong.") });
    } finally {
      setBusyId(null);
    }
  }

  async function download(model: PrinterModelWithPrinters) {
    const error = await downloadProfiles(model);
    if (error) setBanner({ kind: 'error', text: error });
  }

  return (
    <div className="admin printers">
      <PrintersNav />
      <div className="admin__header">
        <div>
          <h1>{t("Printer models")}</h1>
          <p className="muted">{t("Each model's print plate size, colors and slicer profiles apply to every printer of that model, so a change here shows on all of them.")}</p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost" onClick={reload}>{t("Refresh")}</button>
          <Link to="/admin/printer-models/new" className="btn btn--primary">{t("Add printer model")}</Link>
        </div>
      </div>

      {banner && <p className={`banner banner--${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>{banner.text}</p>}

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Model")}</th>
              <th>{t("Print plate (W × D × H)")}</th>
              <th>{t("Max colors")}</th>
              <th>{t("Profiles")}</th>
              <th>{t("Printers")}</th>
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.id}>
                <td>
                  <Link to={modelPath(model.id)} className="admin-table__name">{model.name}</Link>
                  {model.manufacturer && <div className="muted">{model.manufacturer}</div>}
                </td>
                <td>{formatDimensions(model.plate)}</td>
                <td>{formatNumber(model.maxColors)}</td>
                <td><ProfilesCell model={model} onDownload={() => void download(model)} /></td>
                <td>
                  {model.printers.length > 0
                    ? <span title={model.printers.map((p) => p.name).join(', ')}>{formatNumber(model.printers.length)}: {model.printers.map((p) => p.name).join(', ')}</span>
                    : <span className="muted">{t("None")}</span>}
                </td>
                <td>
                  <div className="admin-table__actions">
                    <Link to={modelPath(model.id)} className="btn btn--small">{t("Edit")}</Link>
                    <button type="button" className="btn btn--small btn--ghost btn--danger" disabled={busyId === model.id || model.printers.length > 0}
                      title={model.printers.length > 0 ? t("Printers use this model. Delete them or give them another model first.") : undefined}
                      onClick={() => void remove(model)}>{t("Delete")}</button>
                  </div>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr>
                <td colSpan={6} className="muted admin-table__empty">{t("No printer models yet. Add the models of your printers, then the printers themselves.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
