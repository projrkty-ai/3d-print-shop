import { t } from '../../i18n';
import { useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { EmailTemplate, EmailTemplatesResponse, OrderStatus } from '../../types';
import { useMailDelivery } from './logBookData';
import { STATUS_LABELS } from './orderDisplay';
import { useAdminData } from './useAdminData';

type Templates = Record<OrderStatus, EmailTemplate>;

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;
const used = (template: EmailTemplate) =>
  new Set([...`${template.subject}\n${template.body}`.matchAll(PLACEHOLDER)].map((match) => match[1]));

/** What each variable stands for, shown next to it in the editor. */
function variableHint(name: string): string {
  const hints: Record<string, string> = {
    customerName: t("the customer's name"),
    orderNumber: t("the order or request number"),
    status: t("the new status"),
    orderDate: t("the date it was placed"),
    shopName: t("the shop's name"),
    note: t("your message for this email"),
    items: t("what is printed, one line per item"),
    price: t("the order's price (or that it will be quoted)"),
    printStart: t("in a print queue: when printing is expected to start"),
    printDuration: t("in a print queue: how long the order prints"),
    printEnd: t("in a print queue: when the order should be printed"),
  };
  return hints[name] ?? name;
}

/** One status email per status, the same for every order, with the variables each one may and must use. */
export function AdminEmailTemplatesPage() {
  const { state, setData, reload } = useAdminData(() => api.getEmailTemplates(), []);
  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <h1>{t("Email templates")}</h1>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading email templates…")} />
      </div>
    );
  }
  return <TemplatesEditor saved={state.data} onSaved={setData} />;
}

function TemplatesEditor({ saved, onSaved }: { saved: EmailTemplatesResponse; onSaved: (value: EmailTemplatesResponse) => void }) {
  const [draft, setDraft] = useState<Templates>(saved.templates);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string; details?: string[] } | null>(null);
  const delivery = useMailDelivery();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.templates);
  const keys = Object.keys(saved.definitions) as OrderStatus[];
  const problemCount = keys.filter((key) => problemsOf(key).length > 0).length;

  function problemsOf(key: OrderStatus): string[] {
    const { variables, required } = saved.definitions[key];
    const template = draft[key];
    const names = used(template);
    return [
      ...(!template.subject.trim() ? [t("Enter a subject.")] : []),
      ...(!template.body.trim() ? [t("Enter the message.")] : []),
      ...[...names].filter((name) => !variables.includes(name)).map((name) => t("Unknown variable {0}.", `{{${name}}}`)),
      ...required.filter((name) => !names.has(name)).map((name) => t("Must include {0}.", `{{${name}}}`)),
    ];
  }

  const update = (key: OrderStatus, patch: Partial<EmailTemplate>) => setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  async function save() {
    setBusy(true);
    setBanner(null);
    try {
      const result = await api.updateEmailTemplates(draft);
      onSaved(result);
      setDraft(result.templates);
      setBanner({ kind: 'success', text: t("Email templates saved.") });
    } catch (err) {
      setBanner(err instanceof ApiError
        ? { kind: 'error', text: err.message, details: err.details }
        : { kind: 'error', text: t("Could not save the email templates.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin email-templates">
      <div className="admin__header">
        <div>
          <h1>{t("Email templates")}</h1>
          <p className="muted">
            {t("The email for each status. In Order processing you can send it with a status change — after seeing a preview — or use it as the start of a message. Variables in double braces are filled in; required ones must stay in the template and have a value when the email is sent.")}
          </p>
          {delivery && (
            <p className="muted">
              {delivery.transport === 'smtp' ? t("Emails are sent from {0}.", delivery.from)
                : delivery.transport === 'outbox' ? t("Development mode: emails are saved as files in the server's outbox folder instead of being sent.")
                  : t("Email sending isn't configured on the server (SMTP_HOST, MAIL_FROM): emails will be logged as failed.")}
            </p>
          )}
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost" disabled={!dirty || busy} onClick={() => setDraft(saved.templates)}>{t("Discard changes")}</button>
          <button type="button" className="btn btn--primary" disabled={!dirty || busy || problemCount > 0} onClick={() => void save()}>
            {busy ? t("Saving…") : t("Save changes")}
          </button>
        </div>
      </div>

      {banner && (
        <div className={`banner banner--${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
          {banner.details?.length ? <strong>{banner.text}</strong> : banner.text}
          {banner.details && banner.details.length > 0 && <ul>{banner.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}

      <section className="card">
        <h2>{t("Order statuses")}</h2>
        <p className="muted">{t("One email per status, the same for every order: catalog products, customers' own models, external projects and Print on Demand.")}</p>
        <div className="email-templates__list">
          {keys.map((key) => (
            <TemplateEditor
              key={key}
              title={STATUS_LABELS[key] ?? saved.definitions[key].label}
              template={draft[key]}
              definition={saved.definitions[key]}
              isDefault={JSON.stringify(draft[key]) === JSON.stringify(saved.defaults[key])}
              problems={problemsOf(key)}
              onChange={(patch) => update(key, patch)}
              onRestore={() => update(key, saved.defaults[key])}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface EditorProps {
  title: string;
  template: EmailTemplate;
  definition: EmailTemplatesResponse['definitions'][OrderStatus];
  isDefault: boolean;
  problems: string[];
  onChange: (patch: Partial<EmailTemplate>) => void;
  onRestore: () => void;
}

function TemplateEditor({ title, template, definition, isDefault, problems, onChange, onRestore }: EditorProps) {
  const body = useRef<HTMLTextAreaElement>(null);

  /** Inserts `{{name}}` at the cursor of the message (or at its end). */
  function insert(name: string) {
    const field = body.current;
    const text = `{{${name}}}`;
    const at = field ? field.selectionStart : template.body.length;
    const end = field ? field.selectionEnd : at;
    onChange({ body: template.body.slice(0, at) + text + template.body.slice(end) });
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + text.length, at + text.length);
    });
  }

  return (
    <article className="email-template" aria-label={title}>
      <div className="email-template__header">
        <h3>{title}</h3>
        <button type="button" className="btn btn--small btn--ghost" disabled={isDefault} onClick={onRestore}>{t("Restore default")}</button>
      </div>
      <div className="email-template__variables">
        <span className="muted">{t("Variables (click to insert):")}</span>
        {definition.variables.map((name) => (
          <button
            key={name}
            type="button"
            className={`variable-chip ${definition.required.includes(name) ? 'variable-chip--required' : ''}`}
            title={`${variableHint(name)}${definition.required.includes(name) ? ` — ${t("required")}` : ''}`}
            onClick={() => insert(name)}
          >
            {`{{${name}}}`}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t("Subject")}</span>
        <input value={template.subject} onChange={(e) => onChange({ subject: e.target.value.replace(/[\r\n]/g, ' ') })} maxLength={200} />
      </label>
      <label className="field">
        <span>{t("Message")}</span>
        <textarea ref={body} rows={8} value={template.body} onChange={(e) => onChange({ body: e.target.value })} maxLength={10_000} />
      </label>
      {problems.length > 0 && (
        <ul className="email-template__problems" role="alert">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
    </article>
  );
}
