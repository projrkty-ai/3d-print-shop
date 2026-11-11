import { t } from '../../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { FilamentChoice, MeshFormat, Order, ProjectFile } from '../../types';

/** How the order prints one model file: copies in the whole order (sets × copies per set), scale and filaments. */
export interface ProjectFileUse {
  copies: number;
  scalePercent: number;
  filaments: FilamentChoice[];
}

/** One of the external project's files the order prints, with every way it is printed. */
export interface OrderProjectFile {
  file: ProjectFile;
  uses: ProjectFileUse[];
}

/**
 * The external project's files an order prints, each once (as the server lists them): the chosen
 * models of a project order, or the models of the ordered Print on Demand sets. Whole-project items
 * (the site listed no files) have none.
 */
export function orderProjectFiles(order: Pick<Order, 'items'>): OrderProjectFile[] {
  const files = new Map<string, OrderProjectFile>();
  const add = (file: ProjectFile | null, use: ProjectFileUse) => {
    if (!file) return;
    const entry = files.get(file.id) ?? { file, uses: [] };
    entry.uses.push(use);
    files.set(file.id, entry);
  };
  for (const { model, quantity } of order.items) {
    if (model.source === 'project') add(model.file, { copies: quantity, scalePercent: model.scalePercent, filaments: model.filaments });
    if (model.source === 'printOnDemand') {
      for (const { file, settings } of model.models) add(file, { copies: settings.quantity * quantity, scalePercent: settings.scalePercent, filaments: settings.filaments });
    }
  }
  return [...files.values()];
}

/** A project file downloaded on this page. */
export interface DownloadedProjectFile {
  blob: Blob;
  fileName: string;
  /** STL or 3MF (can be sliced); null for other formats. */
  format: MeshFormat | null;
}

export type ProjectFileStatus =
  | { status: 'idle' }
  | { status: 'downloading' }
  | { status: 'ready'; file: DownloadedProjectFile }
  | { status: 'error'; message: string; details: string[] };

export interface ProjectFiles {
  files: OrderProjectFile[];
  statusOf: (sourceFileId: string) => ProjectFileStatus;
  /**
   * The file, downloaded from the project's site through the server when it is first needed on this
   * page (to slice or save it); later uses on the page reuse it. A failed download is tried again on
   * the next call.
   */
  download: (sourceFileId: string) => Promise<DownloadedProjectFile>;
}

const errorOf = (err: unknown) => (err instanceof ApiError
  ? { message: err.message, details: err.details }
  : { message: err instanceof Error ? err.message : t("Could not download the model file."), details: [] });

/**
 * An order's external project files, downloaded from the project's site only when the admin slices
 * or saves them. The shop keeps no copy: the downloads live in this page's memory and are gone when
 * it closes.
 */
export function useProjectFiles(order: Order): ProjectFiles {
  const files = orderProjectFiles(order);
  const orderId = order.id;
  const [statuses, setStatuses] = useState<Record<string, ProjectFileStatus>>({});
  const downloads = useRef(new Map<string, Promise<DownloadedProjectFile>>());
  const names = useRef(new Map(files.map(({ file }) => [file.id, file.name])));

  useEffect(() => {
    const cache = downloads.current;
    return () => cache.clear();
  }, [orderId]);

  const download = useCallback((sourceFileId: string): Promise<DownloadedProjectFile> => {
    let pending = downloads.current.get(sourceFileId);
    if (!pending) {
      const set = (status: ProjectFileStatus) => setStatuses((prev) => ({ ...prev, [sourceFileId]: status }));
      set({ status: 'downloading' });
      pending = api.downloadProjectFile(orderId, sourceFileId).then(
        ({ blob, fileName, format }) => {
          const file = { blob, fileName: fileName ?? names.current.get(sourceFileId) ?? sourceFileId, format };
          set({ status: 'ready', file });
          return file;
        },
        (err: unknown) => {
          downloads.current.delete(sourceFileId);
          set({ status: 'error', ...errorOf(err) });
          throw err;
        },
      );
      downloads.current.set(sourceFileId, pending);
    }
    return pending;
  }, [orderId]);

  const statusOf = (sourceFileId: string): ProjectFileStatus => statuses[sourceFileId] ?? { status: 'idle' };

  return { files, statusOf, download };
}
