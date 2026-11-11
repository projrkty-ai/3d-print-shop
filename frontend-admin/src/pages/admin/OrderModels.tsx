import { formatCount, formatNumber, t } from '../../i18n';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { ConfigurationDetails, ItemThumbnail } from '../../components/ConfiguredItem';
import { useProducts } from '../../store/ProductsContext';
import type { CatalogModel, Order, OrderItem, PrintOnDemandModel, ProjectModel } from '../../types';
import type { UploadFile } from '../../utils/printEstimate';
import { formatPrice } from '../../utils/pricing';
import { CustomModelFacts, EstimateText, fileEstimate, PrintChoices } from './CustomModelFacts';
import { CustomModelViewer } from './CustomModelViewer';
import { OrderedTextures, OrderItemViewer } from './OrderItemViewer';
import { formatBytes, SOURCE_LABELS, totalCopies, uploadFiles } from './orderDisplay';
import { ProjectItems } from './ProjectItems';
import type { CustomerModel } from './useCustomerModels';

interface Props {
  order: Order;
  /** The shop's reading of uploaded files (their miniatures, parts and plates). */
  modelOf: (file: Pick<UploadFile, 'fileId'>) => CustomerModel;
  /** Saves an uploaded file; reports a failure through `onError`. */
  onDownload: (file: UploadFile) => Promise<void>;
  /** The file being saved, if any. */
  downloading: string | null;
}

/**
 * What the order prints — the only part of an order that depends on where its models come from:
 * configured catalog products, the customer's own files, an external project's models, or a Print on
 * Demand product's set.
 */
export function OrderModels(props: Props) {
  const { order } = props;
  return (
    <section className="card order-models">
      <h2>{t("Models")}</h2>
      <p className="muted">{formatCount('print', totalCopies(order))}</p>
      {order.source === 'catalog' && <CatalogModels order={order} />}
      {order.source === 'upload' && <UploadModels {...props} />}
      {order.source === 'project' && <ProjectModels order={order} />}
      {order.source === 'printOnDemand' && <PrintOnDemandModels order={order} />}
    </section>
  );
}

const itemsOf = <M extends OrderItem['model']>(order: Order, source: M['source']) =>
  order.items.filter((item): item is OrderItem<M> => item.model.source === source);

/** Configured catalog products, each with its 3D view and price breakdown. */
function CatalogModels({ order }: { order: Order }) {
  const { getProduct } = useProducts();
  /** Index of the item shown in the 3D viewer. */
  const [viewing, setViewing] = useState<number | null>(null);
  const items = itemsOf<CatalogModel>(order, 'catalog');
  const viewed = viewing === null ? undefined : items[viewing];
  return (
    <>
      {viewed && viewing !== null && (
        <OrderItemViewer item={viewed} product={getProduct(viewed.model.productId)} orderNumber={order.number} position={viewing + 1}
          onClose={() => setViewing(null)} />
      )}
      <ul className="order-items">
        {items.map((item, i) => (
          <li key={i} className="order-item">
            <ItemThumbnail item={item.model} product={getProduct(item.model.productId)} onOpen={() => setViewing(i)} />
            <div className="order-item__info">
              <Link to={`/product/${item.model.productId}`} className="cart-item__name">{item.model.productName}</Link>
              <ConfigurationDetails item={item.model} />
              <OrderedTextures item={item.model} fileName={`${order.number}-${i + 1}`} />
              <details className="order-item__prices">
                <summary>{t("Price breakdown")}</summary>
                <table className="summary__lines">
                  <tbody>
                    {item.model.priceLines.map((line) => (
                      <tr key={line.label}>
                        <td>
                          {line.label}
                          {line.note && <small className="summary__note">{line.note}</small>}
                        </td>
                        <td>{formatPrice(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
            <div className="order-item__total">
              {item.quantity} × {formatPrice(item.unitPrice ?? 0)}
              <strong>{formatPrice(item.lineTotal ?? 0)}</strong>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The customer's own files: miniatures, facts, print choices, 3D view and download. */
function UploadModels({ order, modelOf, onDownload, downloading }: Props) {
  /** Index of the file shown in the 3D viewer. */
  const [viewing, setViewing] = useState<number | null>(null);
  const files = uploadFiles(order);
  const viewed = viewing === null ? undefined : files[viewing];
  return (
    <>
      {viewed && viewing !== null && (
        <CustomModelViewer file={viewed} model={modelOf(viewed)} orderNumber={order.number} position={viewing + 1}
          onDownload={() => void onDownload(viewed)} onClose={() => setViewing(null)} />
      )}
      <ul className="custom-files">
        {files.map((file, index) => {
          const model = modelOf(file);
          // Orders placed before slicing profiles are estimated from the file's volume.
          const estimate = !file.profile && model.status === 'ready' ? fileEstimate(file, model.result) : null;
          return (
            <li key={file.fileId} className="model-file custom-file">
              {/* The miniature and description open the 3D viewer. */}
              <button type="button" className="custom-file__open" disabled={model.status === 'error'}
                aria-label={t("View {0} in 3D", file.fileName)} title={model.status === 'error' ? undefined : t("View in 3D")}
                onClick={() => setViewing(index)}>
                <span className="custom-file__thumb">
                  {model.status === 'ready' && model.result.thumbnail
                    ? <img src={model.result.thumbnail} alt="" />
                    : <span className="model-file__badge">{file.format.toUpperCase()}</span>}
                </span>
                <span className="custom-file__info">
                  <strong className="custom-file__name">{file.fileName}</strong>
                  <span className="muted">{file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}</span>
                  <PrintChoices file={file} />
                  {model.status === 'ready' && <CustomModelFacts result={model.result} />}
                  {estimate && <EstimateText estimate={estimate} quantity={file.quantity} />}
                  {model.status === 'loading' && <span className="muted">{t("Loading preview…")}</span>}
                  {model.status === 'error' && <span className="custom-file__warning">{t("Preview unavailable")}: {model.message}</span>}
                </span>
              </button>
              <span className="custom-file__copies">× {file.quantity}</span>
              <div className="model-file__actions">
                <button type="button" className="btn btn--small btn--ghost" disabled={downloading !== null}
                  aria-label={t("Download {0}", file.fileName)} onClick={() => void onDownload(file)}>
                  {downloading === file.fileId ? t("Loading…") : t("Download")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The external project (where to get the files) and the customer's wishes for every model. */
function ProjectSummary({ order }: { order: Order }) {
  const { project } = order;
  if (!project) return null;
  const site = SOURCE_LABELS[project.source];
  return (
    <>
      {!project.verified && (
        <p className="banner banner--warning" role="alert">
          {t("The project could not be fetched from {0} when the order was placed; the details below are the customer's copy. Check the link before quoting.", site)}
        </p>
      )}
      <div className="project-summary">
        <div className="project-summary__thumb">
          {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">◆</span>}
        </div>
        <div>
          <span className={`status-badge source-badge--${project.source}`}>{site}</span>
          <h3 className="project-summary__title">{project.title}</h3>
          {project.author && <p className="muted">{t("by {0}", project.author)}</p>}
          {project.license && <p className="muted">{t("License: {0}", project.license)}</p>}
          {project.description && <p className="project-summary__description">{project.description}</p>}
          <a href={project.url} target="_blank" rel="noopener noreferrer">{t("Open on {0}", site)} ↗</a>
          <div className="muted mono">{t("Project id")}: {project.id}</div>
        </div>
      </div>
    </>
  );
}

function ProjectModels({ order }: { order: Order }) {
  const items = itemsOf<ProjectModel>(order, 'project');
  return (
    <>
      <ProjectSummary order={order} />
      <h3>{t("Models to print")}</h3>
      <ProjectItems
        items={items.map(({ model, quantity }) => ({ file: model.file, settings: { quantity, scalePercent: model.scalePercent, filaments: model.filaments } }))}
        sameSettingsForAll={order.project?.sameSettingsForAll ?? false}
      />
    </>
  );
}

/** Sets of a Print on Demand product: the variants ordered and the product's models with the customer's colors. */
function PrintOnDemandModels({ order }: { order: Order }) {
  return itemsOf<PrintOnDemandModel>(order, 'printOnDemand').map(({ model, quantity, unitPrice }) => (
    <div key={model.productId} className="print-on-demand-set">
      <p className={`banner ${model.materialsChanged ? 'banner--warning' : 'banner--info'}`}>
        {model.materialsChanged
          ? t("Ordered from the Print on Demand product {0} (sets: {1}) with other materials than offered, so it needs a quote.", model.title, quantity)
          : t("Ordered from the Print on Demand product {0} ({1} × {2} set price, handling fee once).", model.title, quantity, formatPrice(unitPrice ?? 0))}{' '}
        <Link to={`/admin/print-on-demand/${model.productId}`}>{t("Open product")}</Link>
      </p>
      {model.print && (
        <section className="project-print-choice" aria-label={t("Print variants ordered")}>
          <h3>{t("Print variants ordered")}</h3>
          <p>{t("Scale of the whole set: {0}%", formatNumber(model.print.scale * 100, { maximumFractionDigits: 1 }))}</p>
          <dl className="config-details">
            {model.print.plates.map(({ plateId, name, variant }) => (
              <Fragment key={plateId ?? 'model'}>
                <dt>{name}</dt>
                <dd className="config-details__variant">
                  {variant.label}
                  <small className="muted">
                    {t("{0} mm nozzle · {1} mm layers · {2}", formatNumber(variant.nozzleMm), formatNumber(variant.layerHeightMm), variant.material)}
                    {variant.presets && <><br />{variant.presets.printer} · {variant.presets.process} · {variant.presets.filament}</>}
                    {variant.support !== undefined && <><br />{variant.support ? t("With supports") : t("Without supports")}</>}
                    {variant.overrides && Object.keys(variant.overrides).length > 0 && (
                      <><br />{Object.entries(variant.overrides).map(([key, value]) => `${key} = ${value}`).join('; ')}</>
                    )}
                  </small>
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}
      <ProjectSummary order={order} />
      <h3>{t("Models of one set")}</h3>
      <ProjectItems items={model.models} sameSettingsForAll={false} />
    </div>
  ));
}
