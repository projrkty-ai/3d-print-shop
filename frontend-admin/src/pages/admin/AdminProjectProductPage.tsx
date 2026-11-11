import { t } from '../../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { MeshFormat, PlateSlicing, PricingSettings, ProjectProduct } from '../../types';
import type { MeshAnalysis } from '../../utils/mesh';
import { usesVariantPricing } from '../../utils/printVariants';
import { defaultSetPrice, projectAsProduct, projectPrintErrors, type ProjectPrintSetup } from '../../utils/projectPrint';
import { MeasurementsForm } from './MeasurementsForm';
import { ModelFileCard } from './ModelFileCard';
import { PrintVariantsEditor } from './PrintVariantsEditor';
import { fitScaling, ScalingEditor } from './ScalingEditor';
import { SOURCE_LABELS } from './orderDisplay';
import { PricingBreakdown } from './PricingBreakdown';
import { ProjectItems } from './ProjectItems';
import { useAdminData } from './useAdminData';

export function AdminProjectProductPage() {
  const { productId = '' } = useParams();
  const { state, setData, reload } = useAdminData(
    async () => Promise.all([api.getProjectProduct(productId), api.getPricing()]).then(([product, pricing]) => ({ product, pricing })),
    [productId],
  );
  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <Link to="/admin/print-on-demand" className="muted">{t("← All Print on Demand products")}</Link>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading product…")} />
      </div>
    );
  }
  const { product, pricing } = state.data;
  return <ProjectProductEditor key={product.id} product={product} pricing={pricing} onSaved={(saved) => setData({ product: saved, pricing })} />;
}

/** Title, description, publication and the measurements are editable; the price always follows the current rates. */
function ProjectProductEditor({ product, pricing, onSaved }: { product: ProjectProduct; pricing: PricingSettings; onSaved: (product: ProjectProduct) => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [published, setPublished] = useState(product.published);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const dirty = title !== product.title || description !== product.description || published !== product.published;
  const site = SOURCE_LABELS[product.project.source];

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await api.updateProjectProduct(product.id, { title: title.trim(), description: description.trim(), published }));
      setMessage({ kind: 'success', text: t("Product saved.") });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Could not save the product.") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("Delete \"{0}\"? This cannot be undone.", product.title))) return;
    setBusy(true);
    try {
      await api.deleteProjectProduct(product.id);
      navigate('/admin/print-on-demand');
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not delete the product.") });
      setBusy(false);
    }
  }

  return (
    <div className="admin order-detail">
      <div className="admin__header">
        <div>
          <Link to="/admin/print-on-demand" className="muted">{t("← All Print on Demand products")}</Link>
          <h1>{product.title}</h1>
          <p className="muted">
            {site} · {t("made from")} <Link to={`/admin/orders/${product.sourceOrder.id}`} className="mono">{product.sourceOrder.number}</Link>
          </p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost btn--danger" onClick={() => void remove()} disabled={busy}>{t("Delete product")}</button>
        </div>
      </div>
      {message && <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <div className="order-detail__layout">
        <div>
          <form className="card" onSubmit={(e) => void save(e)}>
            <h2>{t("Shop listing")}</h2>
            <label className="field">
              <span>{t("Title")}</span>
              <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>{t("Description")}</span>
              <textarea rows={4} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              {t("Published in the shop")}
            </label>
            <button type="submit" className="btn btn--primary" disabled={!dirty || busy || !title.trim()}>{busy ? t("Saving…") : t("Save changes")}</button>
          </form>
          <PrintSetup product={product} pricing={pricing} onSaved={onSaved} />
          <section className="card project-review">
            <h2>{t("Print time and filament for one set")}</h2>
            {usesVariantPricing(projectAsProduct(product, product, pricing)) && (
              <p className="muted">{t("Not used while print variants are offered: the price comes from the default variants.")}</p>
            )}
            <MeasurementsForm
              initial={product.measurements}
              pricing={pricing}
              saveLabel={t("Save print time and filament")}
              successText={t("Saved. The shop shows the new price.")}
              previewChangesOnly
              onSave={async (measurements) => onSaved(await api.updateProjectProduct(product.id, { measurements }))}
            />
          </section>
          <section className="card">
            <h2>{t("Models to print")}</h2>
            <ProjectItems items={product.items} sameSettingsForAll={false} />
          </section>
        </div>
        <aside>
          <section className="card">
            <h2>{t("Current price for one set")}</h2>
            <PricingBreakdown pricing={product.pricing} />
            <p className="muted">
              {usesVariantPricing(projectAsProduct(product, product, pricing))
                ? t("Calculated from the default print variants at the original size with the current rates; customers choose other variants and sizes. Customers ordering several sets pay the handling fee once.")
                : t("Calculated from the print time and filament below with the current rates. Customers ordering several sets pay the handling fee once.")}
            </p>
            <a href={product.project.url} target="_blank" rel="noopener noreferrer">{t("Open on {0}", site)} ↗</a>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Saved setup as the editor compares it, to know whether anything changed. */
const setupOf = (product: ProjectProduct): ProjectPrintSetup => ({
  mesh: product.mesh ?? null, model: product.model, slicing: product.slicing, scaling: product.scaling,
});

/**
 * The shop's print file of the product, its scaling and the print variants sliced from it — as for
 * catalog products. Customers then choose a variant per plate and a size; without variants the
 * measurements below price the product.
 */
function PrintSetup({ product, pricing, onSaved }: { product: ProjectProduct; pricing: PricingSettings; onSaved: (product: ProjectProduct) => void }) {
  const [setup, setSetup] = useState<ProjectPrintSetup>(() => structuredClone(setupOf(product)));
  // A newly picked file is uploaded when the setup is saved, so cancelling leaves nothing behind.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const priced = projectAsProduct(product, setup, pricing);
  const dirty = pendingFile !== null || JSON.stringify(setup) !== JSON.stringify(setupOf(product));

  const blobUrl = setup.mesh?.url.startsWith('blob:') ? setup.mesh.url : null;
  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  const change = (update: (current: ProjectPrintSetup) => ProjectPrintSetup) => {
    setSetup(update);
    setMessage(null);
  };
  const modelOf = (analysis: MeshAnalysis, fallback?: number) => ({
    widthMm: analysis.widthMm, depthMm: analysis.depthMm, heightMm: analysis.heightMm,
    volumeCm3: analysis.volumeCm3 > 0 ? analysis.volumeCm3 : fallback ?? 1,
  });

  function loaded(file: File, format: MeshFormat, analysis: MeshAnalysis) {
    setPendingFile(file);
    const model = modelOf(analysis, setup.model?.volumeCm3);
    // Variants were sliced from the previous file.
    change((current) => ({
      mesh: {
        url: URL.createObjectURL(file), format, fileName: file.name, sizeBytes: file.size, triangleCount: analysis.triangleCount,
        parts: analysis.parts.map(({ key, name, color }) => ({ key, name, fileColor: color })),
        plates: analysis.plates.map(({ thumbnail: _thumbnail, ...plate }) => plate),
        plate: analysis.plate,
        ...(analysis.plate !== null && { selectedPlates: [analysis.plate] }),
      },
      model,
      slicing: undefined,
      scaling: fitScaling(current.scaling, model),
    }));
  }

  function platesChanged(plates: number[], analysis: MeshAnalysis) {
    change((current) => {
      if (!current.mesh) return current;
      const model = modelOf(analysis, current.model?.volumeCm3);
      return {
        ...current,
        mesh: {
          ...current.mesh, plate: plates[0], selectedPlates: plates, triangleCount: analysis.triangleCount,
          plates: analysis.plates.map(({ thumbnail: _thumbnail, ...plate }) => plate),
          parts: analysis.parts.map(({ key, name, color }) => ({ key, name: current.mesh?.parts.find((part) => part.key === key)?.name ?? name, fileColor: color })),
        },
        model,
        scaling: fitScaling(current.scaling, model),
      };
    });
  }

  function updateSlicing(update: (slicing: PlateSlicing[]) => PlateSlicing[]) {
    change((current) => {
      const next = update(current.slicing ?? []).filter((entry) => entry.variants.length > 0 || entry.support
        || Object.keys(entry.overrides).length > 0 || Object.values(entry.matrix).some((list) => list.length > 0));
      return { ...current, slicing: next.length > 0 ? next : undefined };
    });
  }

  async function save() {
    const found = projectPrintErrors(priced, setup);
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    setMessage(null);
    try {
      let mesh = setup.mesh ?? null;
      if (pendingFile && mesh) {
        mesh = { ...mesh, url: (await api.uploadModelFile(pendingFile)).url };
        setPendingFile(null);
        setSetup((current) => ({ ...current, mesh }));
      }
      const saved = await api.updateProjectProduct(product.id, {
        mesh,
        ...(mesh && setup.model && { model: setup.model }),
        // Empty lists and a fixed size remove what the product had.
        slicing: setup.slicing ?? [],
        scaling: setup.scaling ?? { enabled: false, minScale: 1, maxScale: 1 },
      });
      onSaved(saved);
      setSetup(structuredClone(setupOf(saved)));
      setMessage({ kind: 'success', text: t("Print setup saved. The shop shows the new price.") });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Could not save the print setup.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-print-setup">
      <ModelFileCard
        mesh={setup.mesh ?? null}
        currentVolumeCm3={setup.model?.volumeCm3 ?? 0}
        onLoaded={loaded}
        onRemove={() => {
          setPendingFile(null);
          change(() => ({ mesh: null, model: undefined, slicing: undefined, scaling: undefined }));
        }}
        onRenamePart={(key, name) => change((current) => (current.mesh
          ? { ...current, mesh: { ...current.mesh, parts: current.mesh.parts.map((part) => (part.key === key ? { ...part, name } : part)) } }
          : current))}
        onPlateChanged={platesChanged}
        onUseVolume={(volumeCm3) => change((current) => (current.model ? { ...current, model: { ...current.model, volumeCm3 } } : current))}
      />
      <ScalingEditor product={priced} onScalingChange={(scaling) => change((current) => ({ ...current, scaling }))}
        examplePrice={(scale) => defaultSetPrice(priced, pricing, scale)} />
      <PrintVariantsEditor product={priced} onChange={updateSlicing} disabled={busy} />
      {problems.length > 0 && (
        <div className="banner banner--error" role="alert">
          <strong>{t("Please fix the following:")}</strong>
          <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
      )}
      {message && <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <div className="project-print-setup__actions">
        <button type="button" className="btn btn--primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? t("Saving…") : t("Save print setup")}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn btn--ghost" onClick={() => {
            setPendingFile(null);
            setSetup(structuredClone(setupOf(product)));
            setProblems([]);
          }}>{t("Discard changes")}</button>
        )}
      </div>
    </div>
  );
}
