import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import type { AdminAuth } from '../auth';
import { normalizePrinterModelInput, PRINTER_MODEL_TEMPLATES, PRINTER_PROFILES_MAX_UPLOAD_BYTES, validatePrinterModel } from '../domain/printers';
import type { Printer, PrinterModel, PrinterModelWithPrinters } from '../domain/types';
import { HttpError, notFound } from '../http';
import { t } from '../i18n';
import { inspectProfilesZip } from '../printerProfiles';
import { printerModelInput } from '../schemas';
import { DuplicateNameError, type Storage } from '../storage';
import { decodeFileName } from './modelFiles';

/** The model with the printers of that model (sorted by name). */
const withPrinters = (model: PrinterModel, printers: Printer[]): PrinterModelWithPrinters => ({
  ...model,
  printers: printers.filter((printer) => printer.modelId === model.id).map(({ id, name }) => ({ id, name })),
});

/**
 * Printer models of the warehouse: the print plate size, colors and slicer profiles shared by every
 * printer of the model. Printers only refer to their model, so a change here shows on all of them. Admin only.
 */
export function printerModelsRouter(db: Storage, { requireAdmin }: AdminAuth) {
  const router = Router();
  router.use(requireAdmin);

  const find = async (id: unknown): Promise<PrinterModel> => {
    const model = await db.printerModels.get(String(id));
    if (!model) throw notFound('Printer model');
    return model;
  };

  /** Stores the model, turning a taken name into a 409 with the same message as a validation problem. */
  async function store(model: PrinterModel, save: () => Promise<void>) {
    try {
      await save();
    } catch (err) {
      if (err instanceof DuplicateNameError) throw new HttpError(409, t('printerModelProblems'), [t('printerModelNameTaken', model.name)]);
      throw err;
    }
  }

  const parseInput = (body: unknown) => {
    const input = normalizePrinterModelInput(printerModelInput.parse(body));
    const problems = validatePrinterModel(input);
    if (problems.length > 0) throw new HttpError(400, t('printerModelProblems'), problems);
    return input;
  };

  const respond = async (model: PrinterModel) => withPrinters(model, await db.printers.list());

  router.get('/', async (_req, res) => {
    const [models, printers] = await Promise.all([db.printerModels.list(), db.printers.list()]);
    res.json(models.map((model) => withPrinters(model, printers)));
  });

  /** Known printers a new model can start from: name, manufacturer, plate size and colors. */
  router.get('/templates', (_req, res) => {
    res.json(PRINTER_MODEL_TEMPLATES);
  });

  router.get('/:id', async (req, res) => {
    res.json(await respond(await find(req.params.id)));
  });

  router.post('/', async (req, res) => {
    const now = new Date().toISOString();
    const model: PrinterModel = { id: randomUUID(), ...parseInput(req.body), profiles: null, createdAt: now, updatedAt: now };
    await store(model, () => db.printerModels.insert(model));
    res.status(201).location(`/api/printer-models/${model.id}`).json(await respond(model));
  });

  /** Replaces the editable fields, for every printer of the model; the uploaded profiles stay as they are. */
  router.put('/:id', async (req, res) => {
    const existing = await find(req.params.id);
    const model: PrinterModel = { ...existing, ...parseInput(req.body), updatedAt: new Date().toISOString() };
    await store(model, async () => {
      if (!(await db.printerModels.replace(model))) throw notFound('Printer model');
    });
    res.json(await respond(model));
  });

  /** A model that printers still use can't be deleted (409 naming them); its profile archive goes with it. */
  router.delete('/:id', async (req, res) => {
    const existing = await find(req.params.id);
    const users = (await db.printers.list()).filter((printer) => printer.modelId === existing.id);
    if (users.length > 0) {
      throw new HttpError(409, t('printerModelInUse', existing.name, users.map((printer) => printer.name).join(', ')));
    }
    if (!(await db.printerModels.delete(existing.id))) throw notFound('Printer model');
    if (existing.profiles) await db.printerFiles.delete(existing.profiles.fileId);
    res.status(204).end();
  });

  /**
   * Uploads the model's slicer profiles as a ZIP (raw body, Content-Type: application/octet-stream,
   * the name in X-File-Name), replacing any previous archive. Answers with the updated model.
   */
  router.post('/:id/profiles', express.raw({ type: 'application/octet-stream', limit: PRINTER_PROFILES_MAX_UPLOAD_BYTES }), async (req, res) => {
    const existing = await find(req.params.id);
    const data: unknown = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, t('profilesBody'));
    const summary = inspectProfilesZip(data);
    if (!summary) throw new HttpError(400, t('invalidProfilesZip'));
    if (summary.entries.length === 0) throw new HttpError(400, t('emptyProfilesZip'));
    const header = req.get('x-file-name');
    const fileName = header ? decodeFileName(header) : 'profiles.zip';
    const uploadedAt = new Date().toISOString();
    const fileId = await db.printerFiles.upload(fileName, data, { modelId: existing.id, uploadedAt });
    const model: PrinterModel = {
      ...existing,
      profiles: { fileId, fileName, sizeBytes: data.length, uploadedAt, ...summary },
      updatedAt: uploadedAt,
    };
    if (!(await db.printerModels.replace(model))) {
      await db.printerFiles.delete(fileId);
      throw notFound('Printer model');
    }
    if (existing.profiles) await db.printerFiles.delete(existing.profiles.fileId);
    res.status(201).json(await respond(model));
  });

  router.get('/:id/profiles', async (req, res) => {
    const model = await find(req.params.id);
    const file = model.profiles && (await db.printerFiles.find(model.profiles.fileId));
    if (!file) throw notFound('Printer profiles');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Length': String(file.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    db.printerFiles.openDownloadStream(file.id).on('error', (err) => res.destroy(err)).pipe(res);
  });

  router.delete('/:id/profiles', async (req, res) => {
    const existing = await find(req.params.id);
    if (!existing.profiles) throw notFound('Printer profiles');
    const model: PrinterModel = { ...existing, profiles: null, updatedAt: new Date().toISOString() };
    if (!(await db.printerModels.replace(model))) throw notFound('Printer model');
    await db.printerFiles.delete(existing.profiles.fileId);
    res.json(await respond(model));
  });

  return router;
}
