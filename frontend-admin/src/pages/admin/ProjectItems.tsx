import { formatNumber, t } from '../../i18n';
import type { ProjectOrderItem, ProjectPrintSettings } from '../../types';
import { MATERIAL_LABELS } from './orderDisplay';

export function formatSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  return bytes >= 1_048_576 ? `${formatNumber(bytes / 1_048_576, { maximumFractionDigits: 1 })} MB` : `${formatNumber(Math.max(1, bytes / 1024), { maximumFractionDigits: 0 })} kB`;
}

/** Quantity, scale and every material/color of one model, as the customer chose them. */
function PrintSettings({ settings }: { settings: ProjectPrintSettings }) {
  return (
    <dl className="project-preferences">
      <dt>{t("Quantity")}</dt>
      <dd>{settings.quantity}</dd>
      <dt>{t("Scale")}</dt>
      <dd>{settings.scalePercent}%</dd>
      <dt>{settings.filaments.length > 1 ? t("Materials and colors") : t("Material and color")}</dt>
      <dd>
        <ol className="project-filaments">
          {settings.filaments.map((filament, index) => (
            <li key={index}>
              <strong>{MATERIAL_LABELS[filament.material]}</strong>
              {' · '}
              {filament.color || <span className="muted">{t("any color")}</span>}
            </li>
          ))}
        </ol>
      </dd>
    </dl>
  );
}

/** Every model to print with its settings; shared settings are shown once. */
export function ProjectItems({ items, sameSettingsForAll }: { items: ProjectOrderItem[]; sameSettingsForAll: boolean }) {
  return (
    <>
  {sameSettingsForAll && items.length > 1 && (
    <p className="muted">{t("The customer chose one selection for all models.")}</p>
  )}
  <ul className="project-items">
    {items.map((item, index) => (
      <li key={item.file?.id ?? 'whole'} className="project-item">
        <div className="project-item__file">
          {item.file?.thumbnailUrl && <img src={item.file.thumbnailUrl} alt="" referrerPolicy="no-referrer" />}
          <span className="project-files__name">{item.file?.name ?? t("Whole project (the site lists no separate files)")}</span>
          {item.file && formatSize(item.file.sizeBytes) && <span className="muted">{formatSize(item.file.sizeBytes)}</span>}
        </div>
        {(!sameSettingsForAll || index === 0) && <PrintSettings settings={item.settings} />}
      </li>
    ))}
  </ul>
  {sameSettingsForAll && items.length > 1 && <p className="muted">{t("Same settings as above for every model.")}</p>}
    </>
  );
}
