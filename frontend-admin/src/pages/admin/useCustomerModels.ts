import { t } from '../../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, loadModelBuffer } from '../../api/client';
import type { UploadFile } from '../../utils/printEstimate';
import type { CustomModelAnalysis } from '../../utils/customModel';
import { fileColors } from '../../utils/printEstimate';

export type CustomerModel =
  | { status: 'loading' }
  | { status: 'ready'; url: string; result: CustomModelAnalysis }
  | { status: 'error'; message: string };

const errorMessage = (err: unknown) =>
  err instanceof ApiError || (err instanceof Error && err.name === 'MeshFileError')
    ? err.message
    : t("Could not read the model file.");

/**
 * An order's private uploaded files, downloaded with the admin key one at a time (bounding memory for
 * large files), measured and rendered as miniatures in the browser. Each file is downloaded once:
 * its object URL also serves the 3D viewer and saving, and is released when the page closes.
 */
export function useCustomerModels(orderId: string, files: UploadFile[]) {
  const [models, setModels] = useState<Record<string, CustomerModel>>({});
  const urls = useRef(new Map<string, Promise<string>>());
  const filesKey = files.map((file) => file.fileId).join(',');

  useEffect(() => {
    const cache = urls.current;
    return () => {
      for (const pending of cache.values()) void pending.then(URL.revokeObjectURL, () => undefined);
      cache.clear();
    };
  }, []);

  /** Object URL of a downloaded file; a failed download is retried on the next call. */
  const fileUrl = useCallback((file: Pick<UploadFile, 'fileId'>): Promise<string> => {
    let pending = urls.current.get(file.fileId);
    if (!pending) {
      pending = api.downloadOrderFile(orderId, file.fileId).then((blob) => URL.createObjectURL(blob));
      urls.current.set(file.fileId, pending);
      pending.catch(() => urls.current.delete(file.fileId));
    }
    return pending;
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    setModels(Object.fromEntries(files.map((file) => [file.fileId, { status: 'loading' } as const])));
    void (async () => {
      for (const file of files) {
        if (cancelled) return;
        let model: CustomerModel;
        try {
          const url = await fileUrl(file);
          // three.js is only loaded once there is a model to read.
          const [data, { analyzeCustomModel }] = await Promise.all([loadModelBuffer(url), import('../../utils/customModel')]);
          model = { status: 'ready', url, result: analyzeCustomModel(data, file.fileName, fileColors(file)) };
        } catch (err) {
          model = { status: 'error', message: errorMessage(err) };
        }
        if (!cancelled) setModels((prev) => ({ ...prev, [file.fileId]: model }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // The files of an order never change; `filesKey` stands for them.
  }, [orderId, filesKey, fileUrl]);

  return { models, fileUrl };
}
