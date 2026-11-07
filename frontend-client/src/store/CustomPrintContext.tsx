import { t } from '../i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyCustomer } from '../components/CustomerFields';
import { CUSTOM_ORDER_MAX_FILES, MAX_QUANTITY, MODEL_MAX_UPLOAD_BYTES } from '../config';
import { api, ApiError } from '../api/client';
import type { Customer, CustomerUpload, PrintSettings } from '../types';
import type { CustomModelInfo } from '../utils/customModel';
import type { ModelOptions } from '../utils/printOptions';
import { formatBytes } from '../utils/format';
import { createId } from '../utils/ids';

/** A model the customer picked for a print request. */
export interface DraftModel {
  key: string;
  file: File;
  quantity: number;
  /** Set once the file has been read in the browser. */
  info: CustomModelInfo | null;
  /** Set once sent to the shop, so a retried confirmation doesn't upload it again. */
  upload: CustomerUpload | null;
  /** The customer's nozzle, layer height and filament choices; null (or outdated entries) fall back to the defaults. */
  options: ModelOptions | null;
  /** Thumbnail in the chosen filament colors (`colors` identifies them); replaces the file's own colors. */
  recolored: { colors: string; image: string } | null;
}

export type SettingsState =
  | { status: 'loading' }
  | { status: 'ready'; settings: PrintSettings }
  | { status: 'error'; message: string };

interface CustomPrintContextValue {
  models: DraftModel[];
  /** Files that could not be added last time, with the reason. */
  rejected: string[];
  /** True while any picked file is still being read. */
  reading: boolean;
  note: string;
  customer: Customer;
  /** The shop's nozzles, layer heights and filaments, loaded when the page first needs them. */
  settings: SettingsState;
  loadSettings: () => void;
  addFiles: (files: File[]) => Promise<void>;
  setOptions: (key: string, options: ModelOptions) => void;
  setRecolored: (key: string, recolored: { colors: string; image: string }) => void;
  setQuantity: (key: string, quantity: number) => void;
  removeModel: (key: string) => void;
  setNote: (note: string) => void;
  setCustomer: (update: (customer: Customer) => Customer) => void;
  markUploaded: (key: string, upload: CustomerUpload) => void;
  /** Forgets uploads the shop no longer accepts (e.g. expired), so they are sent again. */
  forgetUploads: () => void;
  /** Starts a new, empty request. */
  reset: () => void;
}

const CustomPrintContext = createContext<CustomPrintContextValue | null>(null);

const clampQuantity = (quantity: number) => Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)));
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
const readError = (err: unknown) =>
  err instanceof Error && err.name === 'MeshFileError' ? err.message : t("The file could not be read as a 3D model.");

/**
 * The print request being prepared. Held above the routes, so the chosen files (which can't be
 * stored in the browser) survive visiting other pages of the shop; a reload starts over.
 */
export function CustomPrintProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<DraftModel[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [customer, setCustomerState] = useState<Customer>(emptyCustomer);
  const [settings, setSettings] = useState<SettingsState>({ status: 'loading' });
  const settingsRequest = useRef<Promise<void> | null>(null);
  // The latest committed list, for checking duplicates and the file limit when files are added.
  const modelsRef = useRef(models);
  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

  const addFiles = useCallback(async (files: File[]) => {
    const problems: string[] = [];
    const accepted: DraftModel[] = [];
    const current = modelsRef.current;
    for (const file of files) {
      if (!/\.(stl|3mf)$/i.test(file.name)) {
        problems.push(t("{value0}: only STL and 3MF files can be printed.", { value0: file.name }));
      } else if (file.size === 0) {
        problems.push(t("{value0}: the file is empty.", { value0: file.name }));
      } else if (file.size > MODEL_MAX_UPLOAD_BYTES) {
        problems.push(t("{value0}: the file is too large (max {value1}).", { value0: file.name, value1: formatBytes(MODEL_MAX_UPLOAD_BYTES) }));
      } else if ([...current, ...accepted].some((model) => sameFile(model.file, file))) {
        problems.push(t("{value0}: this file is already added.", { value0: file.name }));
      } else if (current.length + accepted.length >= CUSTOM_ORDER_MAX_FILES) {
        problems.push(t("{value0}: at most {value1} files can be sent in one request.", { value0: file.name, value1: CUSTOM_ORDER_MAX_FILES }));
      } else {
        accepted.push({ key: createId('model'), file, quantity: 1, info: null, upload: null, options: null, recolored: null });
      }
    }
    setRejected(problems);
    if (accepted.length === 0) return;
    setModels((prev) => [...prev, ...accepted]);
    // Counted right away, in case more files are dropped before React re-renders.
    modelsRef.current = [...current, ...accepted];

    // three.js is only needed once a file is picked.
    const { readCustomModel } = await import('../utils/customModel');
    for (const model of accepted) {
      try {
        const info = await readCustomModel(model.file);
        setModels((prev) => prev.map((m) => (m.key === model.key ? { ...m, info } : m)));
      } catch (err) {
        setModels((prev) => prev.filter((m) => m.key !== model.key));
        setRejected((prev) => [...prev, `${model.file.name}: ${readError(err)}`]);
      }
    }
  }, []);

  /** Loads (or reloads, e.g. after the shop changed its offer) the print options; one request at a time. */
  const loadSettings = useCallback(() => {
    if (settingsRequest.current) return;
    settingsRequest.current = api.getPrintSettings()
      .then((loaded) => setSettings({ status: 'ready', settings: loaded }))
      .catch((err: unknown) => setSettings((current) => (current.status === 'ready' ? current : {
        status: 'error', message: err instanceof ApiError ? err.message : t("The print options could not be loaded."),
      })))
      .finally(() => {
        settingsRequest.current = null;
      });
  }, []);

  const setOptions = useCallback((key: string, options: ModelOptions) => {
    setModels((prev) => prev.map((m) => (m.key === key ? { ...m, options } : m)));
  }, []);

  const setRecolored = useCallback((key: string, recolored: { colors: string; image: string }) => {
    setModels((prev) => prev.map((m) => (m.key === key ? { ...m, recolored } : m)));
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setModels((prev) => prev.map((m) => (m.key === key ? { ...m, quantity: clampQuantity(quantity) } : m)));
  }, []);
  const removeModel = useCallback((key: string) => setModels((prev) => prev.filter((m) => m.key !== key)), []);
  const setCustomer = useCallback((update: (customer: Customer) => Customer) => setCustomerState(update), []);
  const markUploaded = useCallback((key: string, upload: CustomerUpload) => {
    setModels((prev) => prev.map((m) => (m.key === key ? { ...m, upload } : m)));
  }, []);
  const forgetUploads = useCallback(() => setModels((prev) => prev.map((m) => ({ ...m, upload: null }))), []);
  const reset = useCallback(() => {
    setModels([]);
    setRejected([]);
    setNote('');
    setCustomerState(emptyCustomer);
  }, []);

  const value = useMemo(() => ({
    models, rejected, reading: models.some((m) => m.info === null), note, customer, settings, loadSettings,
    addFiles, setOptions, setRecolored, setQuantity, removeModel, setNote, setCustomer, markUploaded, forgetUploads, reset,
  }), [models, rejected, note, customer, settings, loadSettings, addFiles, setOptions, setRecolored, setQuantity, removeModel,
    setCustomer, markUploaded, forgetUploads, reset]);

  return <CustomPrintContext.Provider value={value}>{children}</CustomPrintContext.Provider>;
}

export function useCustomPrint(): CustomPrintContextValue {
  const ctx = useContext(CustomPrintContext);
  if (!ctx) throw new Error('useCustomPrint must be used inside <CustomPrintProvider>');
  return ctx;
}
