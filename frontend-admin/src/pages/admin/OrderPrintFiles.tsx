import { formatCount, formatNumber, t } from '../../i18n';
import { useState } from 'react';
import { loadModelBuffer } from '../../api/client';
import type { Order, ProjectProduct } from '../../types';
import { readFileBytes, saveBlob } from '../../utils/files';
import { formatBytes, MATERIAL_LABELS, SOURCE_LABELS } from './orderDisplay';
import type { OrderProjectFile, ProjectFiles, ProjectFileUse } from './useProjectFiles';

interface Props {
  order: Order;
  files: ProjectFiles;
  /** The ordered Print on Demand product (for its print file); undefined while loading. */
  product?: ProjectProduct | null;
}

const filamentText = (use: ProjectFileUse) =>
  use.filaments.map((filament) => [MATERIAL_LABELS[filament.material], filament.color].filter(Boolean).join(' ')).join(' + ');

const useText = (use: ProjectFileUse) =>
  [formatCount('copy', use.copies), t("scale {0}%", formatNumber(use.scalePercent)), filamentText(use)].join(' · ');

/** A name that is not in `taken` yet (a number is added before the extension), recorded as taken. */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** What to print, as a text file next to the models in the archive. */
function printList(order: Order, files: OrderProjectFile[], names: Map<string, string>, printFile: string | null): string {
  const lines = [
    t("Order {0}", order.number),
    ...(order.project ? [`${order.project.title} — ${order.project.url}`] : []),
    ...order.items.flatMap(({ model, quantity }) => (model.source === 'printOnDemand'
      ? [t("Print on Demand product {0}: {1}", model.title, formatCount('set', quantity)),
        ...(model.print ? [t("Scale of the whole set: {0}%", formatNumber(model.print.scale * 100, { maximumFractionDigits: 1 }))] : [])]
      : [])),
    '',
    ...(printFile ? [t("{0}: the shop's print file of one set", printFile)] : []),
    ...files.flatMap(({ file, uses }) => uses.map((use) => `${names.get(file.id) ?? file.name}: ${useText(use)}`)),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Every model file the order prints, for printing: the external project's files and, for Print on
 * Demand, the shop's print file. The project's files are downloaded from the project's site (through
 * the server, which keeps no copy) only when the admin saves them, one by one or all at once as a
 * ZIP with a list of what to print.
 */
export function OrderPrintFiles({ order, files, product }: Props) {
  const [zipping, setZipping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const site = order.project ? SOURCE_LABELS[order.project.source] : '';
  const printFile = product?.mesh ?? null;
  const wholeProject = order.items.some(({ model }) => model.source === 'project' && model.file === null);
  const statuses = files.files.map(({ file }) => files.statusOf(file.id));
  const busy = zipping;

  /** Failures are shown on the file's row. */
  async function downloadOne(sourceFileId: string) {
    setMessage(null);
    try {
      const file = await files.download(sourceFileId);
      saveBlob(file.blob, `${order.number}-${file.fileName}`);
    } catch {
      // shown with the file
    }
  }

  async function downloadPrintFile() {
    if (!printFile) return;
    setMessage(null);
    try {
      saveBlob(new Blob([await loadModelBuffer(printFile.url)]), `${order.number}-${printFile.fileName}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  /** Every file (downloaded from the site unless it was on this page already) with the print list, in one archive. */
  async function downloadAll() {
    setZipping(true);
    setMessage(null);
    try {
      const { zipSync, strToU8 } = await import('fflate');
      const taken = new Set<string>(['print-list.txt']);
      const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
      const names = new Map<string, string>();
      const failed: string[] = [];
      let printFileName: string | null = null;
      if (printFile) {
        printFileName = uniqueName(printFile.fileName, taken);
        entries[printFileName] = [new Uint8Array(await loadModelBuffer(printFile.url)), { level: 0 }];
      }
      for (const { file } of files.files) {
        try {
          const downloaded = await files.download(file.id);
          const name = uniqueName(downloaded.fileName, taken);
          entries[name] = [new Uint8Array(await readFileBytes(downloaded.blob)), { level: 0 }];
          names.set(file.id, name);
        } catch {
          failed.push(file.name);
        }
      }
      if (names.size === 0 && !printFileName) throw new Error(t("None of the model files could be downloaded."));
      const list = printList(order, files.files.filter(({ file }) => names.has(file.id)), names, printFileName);
      // Copied into this realm's Uint8Array: the encoder's array may come from another one (e.g. in tests).
      entries['print-list.txt'] = [new Uint8Array(strToU8(list)), { level: 0 }];
      // Models are stored as they are: archiving is for one download, and STL/3MF compress poorly or already are.
      saveBlob(new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${order.number}-models.zip`);
      if (failed.length > 0) setMessage(t("The archive is missing {0}: try again, or download them from the project page.", failed.join(', ')));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setZipping(false);
    }
  }

  return (
    <section className="card order-print-files" aria-labelledby="order-print-files-title">
      <div className="card__header">
        <h2 id="order-print-files-title">{t("Files for printing")}</h2>
        <button type="button" className="btn btn--small" disabled={busy || (files.files.length === 0 && !printFile)} onClick={() => void downloadAll()}>
          {zipping ? t("Preparing the archive…") : t("Download all (.zip)")}
        </button>
      </div>
      <p className="muted card__intro">
        {t("The models this order prints. They are downloaded from {0} when you save or slice them; the shop keeps no copies.", site)}
      </p>
      {message && <p className="banner banner--error" role="alert">{message}</p>}
      <ul className="print-files">
        {printFile && (
          <li className="print-files__file">
            <div>
              <strong>{printFile.fileName}</strong>
              <div className="muted">{t("The shop's print file of one set")} · {formatBytes(printFile.sizeBytes)}</div>
            </div>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => void downloadPrintFile()} aria-label={t("Download {0}", printFile.fileName)}>
              {t("Download")}
            </button>
          </li>
        )}
        {files.files.map(({ file, uses }, index) => {
          const status = statuses[index];
          const downloading = status.status === 'downloading';
          return (
            <li key={file.id} className="print-files__file">
              <div>
                <strong>{status.status === 'ready' ? status.file.fileName : file.name}</strong>
                {uses.map((use, i) => <div key={i} className="muted">{useText(use)}</div>)}
                {status.status === 'ready' ? (
                  <small className="muted">
                    {formatBytes(status.file.blob.size)} · {status.file.format ? status.file.format.toUpperCase() : t("not STL or 3MF: can't be sliced here")}
                  </small>
                ) : file.sizeBytes !== null && <small className="muted">{formatBytes(file.sizeBytes)}</small>}
                {downloading && <div><small className="muted" role="status">{t("Downloading from {0}…", site)}</small></div>}
                {status.status === 'error' && (
                  <div>
                    <small className="print-files__error" role="alert">
                      {status.message}{status.details.length > 0 && ` (${status.details.join('; ')})`}
                    </small>
                  </div>
                )}
              </div>
              <div className="print-files__actions">
                {status.status === 'error' && order.project && (
                  <a className="btn btn--small btn--ghost" href={order.project.url} target="_blank" rel="noopener noreferrer">{t("Open on {0}", site)} ↗</a>
                )}
                <button type="button" className="btn btn--small btn--ghost" disabled={busy || downloading}
                  onClick={() => void downloadOne(file.id)}
                  aria-label={status.status === 'error' ? t("Try downloading {0} again", file.name) : t("Download {0}", file.name)}>
                  {status.status === 'error' ? t("Try again") : t("Download")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {wholeProject && order.project && (
        <p className="muted">
          {t("The customer ordered the whole project, and {0} lists no separate files for it: download them from the project page.", site)}{' '}
          <a href={order.project.url} target="_blank" rel="noopener noreferrer">{t("Open on {0}", site)} ↗</a>
        </p>
      )}
    </section>
  );
}
