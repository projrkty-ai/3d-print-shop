import { Router } from 'express';
import type { AdminAuth } from '../auth';
import {
  defaultTemplates, TEMPLATE_DEFINITIONS, TEMPLATE_KEYS, templateLabel, validateEmailTemplates,
} from '../domain/emailTemplates';
import type { EmailTemplates } from '../domain/types';
import { HttpError } from '../http';
import { t } from '../i18n';
import type { Mailer } from '../mail/mailer';
import { emailTemplatesInput } from '../schemas';
import type { Storage } from '../storage';

/** The templates with what the admin editor needs: variables, required ones and the defaults. */
function describe(templates: EmailTemplates) {
  return {
    ...templates,
    definitions: Object.fromEntries(TEMPLATE_KEYS.map((key) => [key, { ...TEMPLATE_DEFINITIONS[key], label: templateLabel(key) }])),
    defaults: defaultTemplates(),
  };
}

/** Status email templates (admin only) and how emails are delivered. */
export function emailTemplatesRouter(db: Storage, mailer: Mailer, { requireAdmin }: AdminAuth) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', async (_req, res) => {
    const stored = await db.emailTemplates.get();
    res.json(describe({
      templates: { ...defaultTemplates(), ...stored?.templates },
      updatedAt: stored?.updatedAt ?? new Date(0).toISOString(),
    }));
  });

  router.put('/', async (req, res) => {
    const { templates } = emailTemplatesInput.parse(req.body);
    const problems = validateEmailTemplates(templates);
    if (problems.length > 0) throw new HttpError(400, t('emailTemplatesProblems'), problems);
    const saved: EmailTemplates = { templates: templates as EmailTemplates['templates'], updatedAt: new Date().toISOString() };
    await db.emailTemplates.put(saved);
    res.json(describe(saved));
  });

  /** How customer emails leave the shop: `smtp`, `outbox` (development files) or `disabled`. */
  router.get('/delivery', (_req, res) => {
    res.json({ transport: mailer.transport, from: mailer.from });
  });

  return router;
}
