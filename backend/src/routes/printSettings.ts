import { Router } from 'express';
import { t } from '../i18n';
import type { AdminAuth } from '../auth';
import type { Storage } from '../storage';
import { HttpError } from '../http';
import { validatePrintSettings } from '../domain/printSettings';
import type { PrintSettings } from '../domain/types';
import { printSettingsInput } from '../schemas';

/** Slicing profiles and filaments offered for customers' own models: public to read, admin-only to change. */
export function printSettingsRouter(db: Storage, { requireAdmin }: AdminAuth) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const settings = await db.printSettings.get();
    if (!settings) throw new HttpError(404, t('printSettingsMissing'));
    res.json(settings);
  });

  /** Replaces the whole document. Requests already placed keep their own snapshot of names and prices. */
  router.put('/', requireAdmin, async (req, res) => {
    const input = printSettingsInput.parse(req.body);
    const problems = validatePrintSettings(input);
    if (problems.length > 0) throw new HttpError(400, t('printSettingsProblems'), problems);
    const settings: PrintSettings = { ...input, updatedAt: new Date().toISOString() };
    await db.printSettings.put(settings);
    res.json(settings);
  });

  return router;
}
