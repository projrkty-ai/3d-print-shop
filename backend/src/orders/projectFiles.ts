import { PROJECT_FILE_MAX_BYTES } from '../domain/config';
import type { MeshFormat, ModelSource, Order, ProjectFile } from '../domain/types';
import { HttpError } from '../http';
import { t } from '../i18n';
import { FileNotListedError, FileTooLargeError, SourceUnavailableError, type ModelSearch } from '../modelSearch';
import { decodeFileName } from '../routes/modelFiles';
import { detectModelFormat } from './upload';

const SOURCE_LABELS: Record<ModelSource, string> = { thingiverse: 'Thingiverse', printables: 'Printables', makerworld: 'MakerWorld' };

/**
 * The external project's files an order prints, each once: the chosen models of a project order,
 * or the models of the ordered Print on Demand sets. Whole-project items (the site listed no files)
 * have none.
 */
export function orderProjectFiles(order: Pick<Order, 'items'>): ProjectFile[] {
  const files = new Map<string, ProjectFile>();
  for (const { model } of order.items) {
    const listed = model.source === 'project' ? [model.file] : model.source === 'printOnDemand' ? model.models.map((item) => item.file) : [];
    for (const file of listed) if (file && !files.has(file.id)) files.set(file.id, file);
  }
  return [...files.values()];
}

const MODEL_EXTENSION = /\.(stl|3mf|obj|step|stp|amf|ply)$/i;

/** The site's name for the file, made safe; an STL/3MF without an extension gets one. */
function fileName(listed: string, sent: string | null, format: MeshFormat | null): string {
  const name = decodeFileName(encodeURIComponent(sent && MODEL_EXTENSION.test(sent) ? sent : listed));
  return format && !MODEL_EXTENSION.test(name) ? `${name.slice(0, 250)}.${format}` : name;
}

/** A model file of an order, just downloaded from the project's site. */
export interface ProjectFileDownload {
  data: Buffer;
  fileName: string;
  /** STL or 3MF (can be sliced in the browser); null for other formats. */
  format: MeshFormat | null;
}

/**
 * Downloads one of the order's project files (`sourceFileId`: its id on the site) from the project's
 * site, for the admin to slice or save. Nothing is stored: every call downloads the file again. The
 * site must still list the file on the project's page.
 */
export async function downloadProjectFile(modelSearch: ModelSearch, order: Order, sourceFileId: string): Promise<ProjectFileDownload> {
  const listed = orderProjectFiles(order).find((file) => file.id === sourceFileId);
  if (!listed || !order.project) throw new HttpError(404, t('projectFileNotInOrder'));
  const site = SOURCE_LABELS[order.project.source];
  let downloaded: Awaited<ReturnType<ModelSearch['downloadFile']>>;
  try {
    downloaded = await modelSearch.downloadFile({ source: order.project.source, id: order.project.id }, sourceFileId);
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw new HttpError(503, t('projectFileSourceUnavailable', site));
    if (error instanceof FileNotListedError) throw new HttpError(409, t('projectFileNotListed', listed.name, site));
    if (error instanceof FileTooLargeError) throw new HttpError(502, t('projectFileTooLarge', listed.name, Math.round(PROJECT_FILE_MAX_BYTES / 1024 / 1024)));
    throw new HttpError(502, t('projectFileFailed', listed.name, site), error instanceof Error ? [error.message] : undefined);
  }
  if (downloaded.data.length === 0) throw new HttpError(502, t('projectFileFailed', listed.name, site), ['The file is empty.']);
  const format = detectModelFormat(downloaded.data);
  return { data: downloaded.data, fileName: fileName(listed.name, downloaded.fileName, format), format };
}
