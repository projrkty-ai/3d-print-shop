import { t } from '../../i18n';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { LazyProductPreview as ProductPreview } from '../../components/LazyProductPreview';
import { ENGRAVING_FONTS, fontStack, MAX_ENGRAVING_LINES, PRINT_MAX_MM, PRINT_MIN_MM } from '../../config';
import { api, ApiError, toProductBody } from '../../api/client';
import { resolveAssetUrl } from '../../api/urls';
import { useProducts } from '../../store/ProductsContext';
import type { ColorOption, DecorationLayout, MeshFormat, ModelSpec, PreviewShape, Product } from '../../types';
import { engravingLines } from '../../utils/engraving';
import { createId } from '../../utils/ids';
import { fileToResizedDataUrl, ImageUploadError } from '../../utils/image';
import { formatPrice, formatRate, pricePerCm3, sizePrice } from '../../utils/pricing';
import {
  AXES,
  AXIS_LABELS,
  formatDimensions,
  formatVolume,
  maxUniformScale,
  minUniformScale,
  scaleDimensions,
} from '../../utils/sizing';
import type { MeshAnalysis } from '../../utils/mesh';
import { validateProduct } from '../../utils/validation';
import { LoadState } from '../../components/LoadState';
import { NotFoundPage } from '../NotFoundPage';
import { ModelFileCard } from './ModelFileCard';
import { includedProductPlates, plateParts, selectedPlateIds } from '../../utils/meshPlates';
import { decorationLayoutFor } from '../../utils/decorationLayout';
import { DecorationLayoutEditor } from './DecorationLayoutEditor';
import { LazyDescriptionEditor as DescriptionEditor } from '../../components/LazyDescriptionEditor';

const SAMPLE_TEXTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="white"/><path d="M0 0h128v128H0zM128 128h128v128H128z" fill="#555"/><circle cx="128" cy="128" r="70" fill="none" stroke="black" stroke-width="12"/></svg>')}`;

const SHAPE_LABELS: Record<PreviewShape, string> = {
  vase: t("Vase (lathe)"),
  cylinder: t("Cylinder"),
  box: t("Box / cube"),
  sphere: t("Sphere"),
};

function createEmptyProduct(): Product {
  const now = new Date().toISOString();
  return {
    id: '',
    name: '',
    description: '',
    category: '',
    material: 'PLA',
    model: { widthMm: 100, depthMm: 100, heightMm: 100, volumeCm3: 50 },
    basePrice: 10,
    fixedFee: 3,
    productionDays: 3,
    imageUrl: '',
    shape: 'cylinder',
    mesh: null,
    published: false,
    colors: [{ id: createId('color'), name: 'White', hex: '#f4f4f2', priceDelta: 0 }],
    engraving: { enabled: false, maxLength: 20, maxLines: 1, price: 5, fonts: ['Arial'], colorChoice: false, colorPrice: 3 },
    texture: { enabled: false, price: 5 },
    createdAt: now,
    updatedAt: now,
  };
}

export function ProductEditorPage() {
  const { productId } = useParams();
  const { getProduct, load, reload } = useProducts();

  if (!productId) return <ProductEditor key="new" initial={createEmptyProduct()} isNew />;
  if (load.status !== 'ready') return <LoadState load={load} onRetry={() => void reload()} loadingText={t("Loading product…")} />;
  const product = getProduct(productId);
  if (!product) return <NotFoundPage message={t("That product doesn't exist.")} />;
  return <ProductEditor key={product.id} initial={product} isNew={false} />;
}

/** Number input that keeps NaN while the field is empty so validation can flag it. */
function NumberInput({
  value,
  onChange,
  ...rest
}: { value: number; onChange: (value: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
>) {
  return (
    <input
      type="number"
      value={Number.isNaN(value) ? '' : value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      {...rest}
    />
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="field__help">{hint}</small>}
    </label>
  );
}

/** True when the base model and prices are complete enough to price example sizes. */
function canPriceExamples(product: Product): boolean {
  const { model } = product;
  return (
    AXES.every((axis) => Number.isFinite(model[axis]) && model[axis] >= PRINT_MIN_MM && model[axis] <= PRINT_MAX_MM) &&
    Number.isFinite(model.volumeCm3) &&
    model.volumeCm3 > 0 &&
    Number.isFinite(product.basePrice) &&
    product.basePrice >= 0 &&
    Number.isFinite(product.fixedFee) &&
    product.fixedFee >= 0 &&
    product.fixedFee <= product.basePrice
  );
}

/** Example sizes for the pricing table: smallest, half, original and largest printable. */
function exampleScales(model: ModelSpec): { label: string; factor: number }[] {
  const min = minUniformScale(model);
  const max = maxUniformScale(model);
  const candidates = [
    { label: t("Smallest"), factor: min },
    { label: '50%', factor: 0.5 },
    { label: t("Original"), factor: 1 },
    { label: t("Largest"), factor: max },
  ];
  return candidates.filter(
    (c, i) =>
      c.factor >= min - 1e-9 &&
      c.factor <= max + 1e-9 &&
      !candidates.slice(0, i).some((prev) => Math.abs(prev.factor - c.factor) < 0.01),
  );
}

function ProductEditor({ initial, isNew }: { initial: Product; isNew: boolean }) {
  const { createProduct, updateProduct, deleteProduct } = useProducts();
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState<Product>(() => structuredClone(initial));
  const [savedSnapshot, setSavedSnapshot] = useState<Product | null>(() =>
    (location.state as { message?: string } | null)?.message ? draft : null);
  const [errors, setErrors] = useState<string[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewColorId, setPreviewColorId] = useState(initial.colors[0]?.id ?? '');
  const [previewText, setPreviewText] = useState(t("Sample"));
  const [layoutPlateId, setLayoutPlateId] = useState<number | null>(() => includedProductPlates(initial)[0]?.id ?? null);
  const [showSampleTexture, setShowSampleTexture] = useState(true);
  // A newly picked model file is only written to storage on save, so cancelling leaves nothing behind.
  const [pendingModelFile, setPendingModelFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [descriptionBusy, setDescriptionBusy] = useState(false);

  // The unsaved model is previewed from an object URL; release it when replaced or on leaving.
  const blobUrl = draft.mesh?.url.startsWith('blob:') ? draft.mesh.url : null;
  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  const set = <K extends keyof Product>(key: K, value: Product[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const updateModel = (patch: Partial<ModelSpec>) => setDraft((d) => ({ ...d, model: { ...d.model, ...patch } }));
  const updateColor = (id: string, patch: Partial<ColorOption>) =>
    setDraft((d) => ({ ...d, colors: d.colors.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const addColor = () =>
    set('colors', [...draft.colors, { id: createId('color'), name: '', hex: '#888888', priceDelta: 0 }]);

  function toggleFont(font: string, checked: boolean) {
    const fonts = checked
      ? ENGRAVING_FONTS.filter((f) => f === font || draft.engraving.fonts.includes(f))
      : draft.engraving.fonts.filter((f) => f !== font);
    set('engraving', { ...draft.engraving, fonts });
  }

  async function handleImage(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    try {
      set('imageUrl', await fileToResizedDataUrl(file, 800));
    } catch (err) {
      setImageError(err instanceof ImageUploadError ? err.message : t("Could not process the image."));
    }
  }

  function handleModelLoaded(file: File, format: MeshFormat, analysis: MeshAnalysis) {
    const url = URL.createObjectURL(file);
    setPendingModelFile(file);
    setDraft((d) => ({
      ...d,
      mesh: {
        url,
        format,
        fileName: file.name,
        sizeBytes: file.size,
        triangleCount: analysis.triangleCount,
        parts: analysis.parts.map(({ key, name, color }) => ({ key, name, fileColor: color })),
        plates: analysis.plates.map(({ thumbnail: _thumbnail, ...plate }) => plate),
        plate: analysis.plate,
        ...(analysis.plate !== null && { selectedPlates: [analysis.plate] }),
      },
      model: {
        widthMm: analysis.widthMm, depthMm: analysis.depthMm, heightMm: analysis.heightMm,
        volumeCm3: analysis.volumeCm3 > 0 ? analysis.volumeCm3 : d.model.volumeCm3,
      },
    }));
  }

  /** A different plate means different objects: new size and triangle count. */
  function handlePlateChanged(plates: number[], analysis: MeshAnalysis) {
    setDraft((d) =>
      d.mesh
        ? {
            ...d,
            mesh: {
              ...d.mesh, plate: plates[0], selectedPlates: plates, triangleCount: analysis.triangleCount,
              plates: analysis.plates.map(({ thumbnail: _thumbnail, ...plate }) => ({
                ...plate, decorationLayout: d.mesh?.plates.find((old) => old.id === plate.id)?.decorationLayout,
              })),
              parts: analysis.parts.map(({ key, name, color }) => ({
                key, name: d.mesh?.parts.find((part) => part.key === key)?.name ?? name, fileColor: color,
              })),
            },
            model: {
              widthMm: analysis.widthMm, depthMm: analysis.depthMm, heightMm: analysis.heightMm,
              volumeCm3: analysis.volumeCm3 > 0 ? analysis.volumeCm3 : d.model.volumeCm3,
            },
          }
        : d,
    );
  }

  function renamePart(key: string, name: string) {
    setDraft((d) =>
      d.mesh ? { ...d, mesh: { ...d.mesh, parts: d.mesh.parts.map((p) => (p.key === key ? { ...p, name } : p)) } } : d,
    );
  }

  function handleModelRemoved() {
    setPendingModelFile(null);
    set('mesh', null);
  }

  async function handleSave(exitAfterSave = false) {
    if (saving || descriptionBusy) return;
    const problems = validateProduct(draft);
    setErrors(problems);
    if (problems.length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    try {
      let mesh = draft.mesh;
      if (pendingModelFile && mesh) {
        // Replace the local preview URL with the uploaded file's permanent one.
        mesh = { ...mesh, url: (await api.uploadModelFile(pendingModelFile)).url };
        setDraft((current) => ({ ...current, mesh }));
        setPendingModelFile(null);
      }
      const body = toProductBody({ ...draft, mesh, name: draft.name.trim() });
      const saved = isNew ? await createProduct(body) : await updateProduct(draft.id, body);
      if (exitAfterSave) navigate('/admin', { state: { message: t("Saved “{0}”.", saved.name) } });
      else if (isNew) navigate(`/admin/products/${saved.id}`, { replace: true, state: { message: t("Saved “{0}”.", saved.name) } });
      else {
        const next = structuredClone(saved);
        setDraft(next);
        setSavedSnapshot(next);
      }
    } catch (err) {
      setErrors(err instanceof ApiError ? [err.message, ...err.details] : [t("Could not save the product.")]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(t("Delete \"{0}\"? This cannot be undone.", initial.name))) return;
    try {
      await deleteProduct(initial.id);
      navigate('/admin', { state: { message: t("Deleted “{0}”.", initial.name) } });
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : t("Could not delete the product.")]);
    }
  }

  const pricingReady = canPriceExamples(draft);
  const previewColor = draft.colors.find((c) => c.id === previewColorId) ?? draft.colors[0];
  const includedPlates = includedProductPlates(draft);
  const layoutPlate = includedPlates.find((plate) => plate.id === layoutPlateId) ?? includedPlates[0] ?? null;
  const layout = decorationLayoutFor(draft, layoutPlate);
  const previewParts = layoutPlate ? plateParts(draft, layoutPlate) : draft.mesh?.parts ?? [];
  function updateLayout(decorationLayout: DecorationLayout | undefined) {
    setDraft((current) => layoutPlate && current.mesh ? {
      ...current,
      mesh: {
        ...current.mesh,
        plates: current.mesh.plates.map((plate) => plate.id === layoutPlate.id ? { ...plate, decorationLayout } : plate),
      },
    } : { ...current, decorationLayout });
  }
  function renderPlateSelector(label: string) {
    return includedPlates.length > 0 && (
      <Field label={label}>
        <select value={layoutPlate?.id} onChange={(event) => setLayoutPlateId(Number(event.target.value))}>
          {includedPlates.map((plate) => <option key={plate.id} value={plate.id}>{plate.name}</option>)}
        </select>
      </Field>
    );
  }
  // Show only as many lines as customers will be allowed to enter.
  const previewEngraving = engravingLines(previewText)
    .slice(0, Math.max(1, draft.engraving.maxLines || 1))
    .join('\n');

  return (
    <div className="admin editor">
      <div className="admin__header">
        <div>
          <Link to="/admin" className="muted">{t("← All products")}</Link>
          <h1>{isNew ? t("New product") : t("Edit “{0}”", initial.name)}</h1>
        </div>
        <div className="admin__header-actions">
          {!isNew && (
            <button type="button" className="btn btn--ghost btn--danger" disabled={saving} onClick={() => void handleDelete()}>{t("Delete")}</button>
          )}
          <Link to="/admin" className="btn btn--ghost">{t("Cancel")}</Link>
          <button type="button" className="btn btn--primary" onClick={() => void handleSave()} disabled={saving || descriptionBusy}>
            {saving ? t("Saving…") : t("Save product")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void handleSave(true)} disabled={saving || descriptionBusy}>{t("Save and exit")}</button>
        </div>
      </div>

      {savedSnapshot === draft && <p className="banner banner--success" role="status">{t("Saved “")}{draft.name}”.</p>}
      {errors.length > 0 && (
        <div className="banner banner--error" role="alert">
          <strong>{t("Please fix the following:")}</strong>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className="editor__layout" disabled={saving}>
        <div className="editor__form">
          <section className="card">
            <h2>{t("Basic information")}</h2>
            <div className="form-grid">
              <Field label={t("Name")}>
                <input value={draft.name} onChange={(e) => set('name', e.target.value)} required />
              </Field>
              <Field label={t("Category")}>
                <input value={draft.category} onChange={(e) => set('category', e.target.value)} />
              </Field>
              <Field label={t("Material")}>
                <input value={draft.material} onChange={(e) => set('material', e.target.value)} />
              </Field>
              <Field label={t("Preview shape")} hint={t("Used when there's no 3D model file, and for the catalog icon.")}>
                <select value={draft.shape} onChange={(e) => set('shape', e.target.value as PreviewShape)}>
                  {Object.entries(SHAPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Production time (days)")}>
                <NumberInput min={0} step={1} value={draft.productionDays} onChange={(v) => set('productionDays', v)} />
              </Field>
            </div>
            <DescriptionEditor
              value={draft.description}
              format={draft.descriptionFormat}
              gallery={draft.gallery ?? []}
              imageUrl={draft.imageUrl}
              onImageUrlChange={(imageUrl) => set('imageUrl', imageUrl)}
              onChange={(description) => setDraft((current) => ({ ...current, description, descriptionFormat: 'html' }))}
              onGalleryChange={(update) => setDraft((current) => ({
                ...current, gallery: typeof update === 'function' ? update(current.gallery ?? []) : update,
              }))}
              onBusyChange={setDescriptionBusy}
              disabled={saving}
            />
            <div className="field" id="product-photo">
              <span>{t("Product photo (optional)")}</span>
              <div className="image-field">
                {draft.imageUrl && <img src={resolveAssetUrl(draft.imageUrl)} alt="" />}
                <div>
                  <input
                    type="url"
                    placeholder={t('https://… or upload a file')}
                    value={draft.imageUrl.startsWith('data:') ? '' : draft.imageUrl}
                    onChange={(e) => set('imageUrl', e.target.value)}
                  />
                  <div className="image-field__actions">
                    <label className="btn btn--small btn--ghost">{t("Upload")}<input type="file" accept="image/*" hidden onChange={(e) => void handleImage(e.target.files?.[0])} />
                    </label>
                    {draft.imageUrl && (
                      <button type="button" className="btn btn--small btn--ghost btn--danger" onClick={() => set('imageUrl', '')}>{t("Remove")}</button>
                    )}
                  </div>
                  {imageError && <small className="field__help is-error">{imageError}</small>}
                </div>
              </div>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={draft.published} onChange={(e) => set('published', e.target.checked)} />{t("Published (visible to customers)")}</label>
          </section>

          <ModelFileCard
            mesh={draft.mesh}
            currentVolumeCm3={draft.model.volumeCm3}
            onLoaded={handleModelLoaded}
            onRemove={handleModelRemoved}
            onRenamePart={renamePart}
            onPlateChanged={handlePlateChanged}
            onUseVolume={(volumeCm3) => updateModel({ volumeCm3 })}
          />

          <section className="card">
            <h2>{t("Base model & pricing")}</h2>
            <p className="muted card__intro">{t("Customers choose any print size in millimeters (")}{PRINT_MIN_MM}–{PRINT_MAX_MM} {t("mm per side). Every print costs the fixed fee plus a price per cm³ of material; the rate is set so the original size costs exactly the price you enter: (price at original size − fixed fee) ÷ model volume.")}</p>
            <div className="form-grid form-grid--4">
              {AXES.map((axis) => (
                <Field key={axis} label={`${AXIS_LABELS[axis]} (mm)`}>
                  <NumberInput
                    min={PRINT_MIN_MM}
                    max={PRINT_MAX_MM}
                    step={0.1}
                    value={draft.model[axis]}
                    onChange={(value) => updateModel({ [axis]: value })}
                  />
                </Field>
              ))}
              <Field label={t("Volume (cm³)")} hint={t("Material volume from your slicer.")}>
                <NumberInput
                  min={0.1}
                  step={0.1}
                  value={draft.model.volumeCm3}
                  onChange={(volumeCm3) => updateModel({ volumeCm3 })}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label={t("Price at original size")}>
                <NumberInput min={0} step={0.5} value={draft.basePrice} onChange={(v) => set('basePrice', v)} />
              </Field>
              <Field label={t("Fixed fee per print")} hint={t("Setup, machine time and handling — charged at every size.")}>
                <NumberInput min={0} step={0.5} value={draft.fixedFee} onChange={(v) => set('fixedFee', v)} />
              </Field>
            </div>
            {pricingReady ? (
              <div className="table-wrap">
                <table className="option-table price-examples">
                  <caption>{t("Example prices:")} {formatPrice(draft.fixedFee)} {t("fee +")} {formatRate(pricePerCm3(draft))} {t("(before color, engraving and texture)")}</caption>
                  <thead>
                    <tr>
                      <th>{t("Scale")}</th>
                      <th>{t("Size")}</th>
                      <th>{t("Volume")}</th>
                      <th>{t("Print price")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exampleScales(draft.model).map(({ label, factor }) => {
                      const dims = scaleDimensions(draft.model, factor);
                      const price = sizePrice(draft, dims);
                      return (
                        <tr key={label}>
                          <td>
                            {label}
                            {!label.endsWith('%') && <span className="muted"> ({Math.round(factor * 100)}%)</span>}
                          </td>
                          <td>{formatDimensions(dims)}</td>
                          <td>{formatVolume(price.volumeCm3)}</td>
                          <td>{formatPrice(price.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{t("Fill in valid model dimensions, volume and prices to see example prices.")}</p>
            )}
          </section>

          <section className="card">
            <div className="card__header">
              <h2>{t("Colors")}</h2>
              <button type="button" className="btn btn--small" onClick={addColor}>{t("+ Add color")}</button>
            </div>
            <div className="table-wrap">
              <table className="option-table">
                <thead>
                  <tr>
                    <th>{t("Color")}</th>
                    <th>{t("Name")}</th>
                    <th>{t("Hex")}</th>
                    <th>{t("Price change")}</th>
                    <th aria-label={t("Remove")} />
                  </tr>
                </thead>
                <tbody>
                  {draft.colors.map((color) => (
                    <tr key={color.id}>
                      <td>
                        <input
                          type="color"
                          value={/^#[0-9a-f]{6}$/i.test(color.hex) ? color.hex : '#000000'}
                          onChange={(e) => updateColor(color.id, { hex: e.target.value })}
                          aria-label={t("Pick {0}", color.name || t('color'))}
                        />
                      </td>
                      <td>
                        <input value={color.name} onChange={(e) => updateColor(color.id, { name: e.target.value })} placeholder={t("Ocean Teal")} />
                      </td>
                      <td>
                        <input
                          value={color.hex}
                          onChange={(e) => updateColor(color.id, { hex: e.target.value.trim() })}
                          className="mono"
                          maxLength={7}
                        />
                      </td>
                      <td>
                        <NumberInput step={0.5} value={color.priceDelta} onChange={(priceDelta) => updateColor(color.id, { priceDelta })} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t("Remove color {0}", color.name)}
                          onClick={() => set('colors', draft.colors.filter((c) => c.id !== color.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-label={t("Engraving settings")}>
            <div className="card__header">
              <h2>{t("Engraving")}</h2>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.engraving.enabled}
                  onChange={(e) => set('engraving', { ...draft.engraving, enabled: e.target.checked })}
                  aria-label={t("Enable engraving")}
                />
                <span />
              </label>
            </div>
            {draft.engraving.enabled ? (
              <>
                <div className="form-grid">
                  <Field label={t("Price")}>
                    <NumberInput
                      min={0}
                      step={0.5}
                      value={draft.engraving.price}
                      onChange={(price) => set('engraving', { ...draft.engraving, price })}
                    />
                  </Field>
                  <Field label={t("Max characters")} hint={t("Total for all lines; line breaks don't count.")}>
                    <NumberInput
                      min={1}
                      step={1}
                      value={draft.engraving.maxLength}
                      onChange={(maxLength) => set('engraving', { ...draft.engraving, maxLength })}
                    />
                  </Field>
                  <Field label={t("Max lines")} hint={t("1 = single-line engraving.")}>
                    <NumberInput
                      min={1}
                      max={MAX_ENGRAVING_LINES}
                      step={1}
                      value={draft.engraving.maxLines}
                      onChange={(maxLines) => set('engraving', { ...draft.engraving, maxLines })}
                    />
                  </Field>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.engraving.colorChoice}
                    onChange={(e) => set('engraving', { ...draft.engraving, colorChoice: e.target.checked })}
                  />{t("Let customers choose a text color (any of this product's filament colors)")}</label>
                {draft.engraving.colorChoice && (
                  <div className="form-grid engraving-color-settings">
                    <Field
                      label={t("Colored text surcharge")}
                      hint={t("Added when the letters get their own color. Premium filament surcharges apply on top, once per filament.")}
                    >
                      <NumberInput
                        min={0}
                        step={0.5}
                        value={draft.engraving.colorPrice}
                        onChange={(colorPrice) => set('engraving', { ...draft.engraving, colorPrice })}
                      />
                    </Field>
                  </div>
                )}
                <div className="field">
                  <span>{t("Available fonts")}</span>
                  <div className="font-options">
                    {ENGRAVING_FONTS.map((font) => (
                      <label key={font} className="checkbox" style={{ fontFamily: fontStack(font) }}>
                        <input
                          type="checkbox"
                          checked={draft.engraving.fonts.includes(font)}
                          onChange={(e) => toggleFont(font, e.target.checked)}
                        />
                        {font}
                      </label>
                    ))}
                  </div>
                </div>
                {renderPlateSelector(t("Engraving plate"))}
                <DecorationLayoutEditor
                  value={layout}
                  textEnabled
                  textureEnabled={false}
                  onChange={updateLayout}
                />
              </>
            ) : (
              <p className="muted">{t("Customers can't add engraving to this product.")}</p>
            )}
          </section>

          <section className="card" aria-label={t("Picture texture settings")}>
            <div className="card__header">
              <h2>{t("Picture texture")}</h2>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.texture.enabled}
                  onChange={(e) => set('texture', { ...draft.texture, enabled: e.target.checked })}
                  aria-label={t("Enable picture texture")}
                />
                <span />
              </label>
            </div>
            {draft.texture.enabled ? (
              <>
                <Field label={t("Price")} hint={t("Customers upload an image that is embossed into the surface.")}>
                  <NumberInput
                    min={0}
                    step={0.5}
                    value={draft.texture.price}
                    onChange={(price) => set('texture', { ...draft.texture, price })}
                  />
                </Field>
                {renderPlateSelector(t("Texture plate"))}
                <DecorationLayoutEditor
                  value={layout}
                  textEnabled={false}
                  textureEnabled
                  onChange={updateLayout}
                />
              </>
            ) : (
              <p className="muted">{t("Customers can't upload a picture texture for this product.")}</p>
            )}
          </section>
        </div>

        <aside className="editor__preview">
          <div className="card">
            <h2>{t("Live preview")}</h2>
            {layoutPlate && <p className="muted">{t("Plate:")} {layoutPlate.name}</p>}
            {(draft.engraving.enabled || draft.texture.enabled) && (
              <p className="muted">{t("The sample text and checker pattern are not saved as customer content.")}</p>
            )}
            {previewColor ? (
              <>
                <ProductPreview
                  shape={draft.shape}
                  color={/^#[0-9a-f]{6}$/i.test(previewColor.hex) ? previewColor.hex : '#888888'}
                  scale={[1, 1, 1]}
                  caption={pricingReady ? t("Original size: {0}", formatDimensions(layoutPlate?.model ?? draft.model)) : undefined}
                  engravingText={draft.engraving.enabled ? previewEngraving : ''}
                  engravingFont={draft.engraving.fonts[0] ?? 'Arial'}
                  textureDataUrl={draft.texture.enabled && showSampleTexture ? SAMPLE_TEXTURE : null}
                  decorationLayout={layout}
                  meshUrl={draft.mesh?.url}
                  meshPlate={layoutPlate?.id ?? draft.mesh?.plate}
                  className="preview--compact"
                />
                {draft.mesh && selectedPlateIds(draft.mesh).length > 1 && (
                  <p className="muted">{t("Showing one plate for placement editing. The base price includes all")} {selectedPlateIds(draft.mesh).length} {t("selected plates.")}</p>
                )}
                {previewParts.length > 0 ? (
                  <p className="muted">{t("Showing the colors from the model file, as customers first see them.")}</p>
                ) : (
                  <div className="form-grid">
                    <Field label={t("Color")}>
                      <select value={previewColor.id} onChange={(e) => setPreviewColorId(e.target.value)}>
                        {draft.colors.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name || '(unnamed)'}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
                {draft.engraving.enabled && (
                  <Field label={t("Sample engraving")}>
                    {draft.engraving.maxLines > 1 ? (
                      <textarea
                        rows={Math.min(draft.engraving.maxLines, MAX_ENGRAVING_LINES)}
                        value={previewText}
                        onChange={(e) => setPreviewText(e.target.value)}
                      />
                    ) : (
                      <input value={previewText} onChange={(e) => setPreviewText(e.target.value)} />
                    )}
                    {draft.texture.enabled && (
                      <label className="checkbox">
                        <input type="checkbox" checked={showSampleTexture} onChange={(event) => setShowSampleTexture(event.target.checked)} />{t("Show sample texture")}</label>
                    )}
                  </Field>
                )}
              </>
            ) : (
              <p className="muted">{t("Add at least one color to see the preview.")}</p>
            )}
          </div>
        </aside>
      </fieldset>
    </div>
  );
}
