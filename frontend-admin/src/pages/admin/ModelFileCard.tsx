import { formatCount, t } from '../../i18n';
import { useRef, useState, type DragEvent } from 'react';
import { loadModelBuffer } from '../../api/client';
import { LOCALE, MODEL_MAX_UPLOAD_BYTES } from '../../config';
import type { MeshFile, MeshFormat } from '../../types';
import { formatDimensions, formatVolume } from '../../utils/sizing';
import type { MeshAnalysis } from '../../utils/mesh';
import { selectedPlateIds } from '../../utils/meshPlates';

interface Props {
  mesh: MeshFile | null;
  currentVolumeCm3: number;
  onLoaded: (file: File, format: MeshFormat, analysis: MeshAnalysis) => void;
  onRemove: () => void;
  onRenamePart: (key: string, name: string) => void;
  onUseVolume: (volumeCm3: number) => void;
  /** A different plate of a multi-plate project was chosen; `analysis` describes that plate. */
  onPlateChanged: (plates: number[], analysis: MeshAnalysis) => void;
}

const sizeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${sizeFormat.format(bytes / 1024)} KB` : `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

const plateName = (analysis: MeshAnalysis) => analysis.plates.find((p) => p.id === analysis.plate)?.name ?? '';

/** Upload/replace/remove the product's STL or 3MF file; reads it to fill in the model's size and volume. */
export function ModelFileCard({
  mesh,
  currentVolumeCm3,
  onLoaded,
  onRemove,
  onRenamePart,
  onUseVolume,
  onPlateChanged,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Result of the most recent upload or plate change in this session (not stored with the product).
  const [analysis, setAnalysis] = useState<MeshAnalysis | null>(null);
  // The file's contents, kept so switching plates doesn't download or re-read it.
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  // Plate thumbnails come from the project file; they're too large to store with the product.
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  const readError = (err: unknown) =>
    err instanceof Error && err.name === 'MeshFileError' ? err.message : t("Could not read the model file.");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/\.(stl|3mf)$/i.test(file.name)) {
      setError(t("Please choose an .stl or .3mf file."));
      return;
    }
    if (file.size > MODEL_MAX_UPLOAD_BYTES) {
      setError(t("The file is too large (max {0}).", formatBytes(MODEL_MAX_UPLOAD_BYTES)));
      return;
    }
    setBusy(true);
    try {
      // three.js is only needed here, so keep it out of the admin bundle until a file is picked.
      const { analyzeMesh, detectMeshFormat, parseMeshFile } = await import('../../utils/mesh');
      const data = await file.arrayBuffer();
      const raw = parseMeshFile(data, { fileName: file.name });
      let result = analyzeMesh(raw);
      raw.dispose();
      if (result.plate !== null) {
        const geometry = parseMeshFile(data, { plates: [result.plate] });
        result = analyzeMesh(geometry);
        geometry.dispose();
      }
      setAnalysis(result);
      setFileData(data);
      setThumbnails(Object.fromEntries(result.plates.flatMap((p) => (p.thumbnail ? [[p.id, p.thumbnail]] : []))));
      onLoaded(file, detectMeshFormat(data), result);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function choosePlate(plate: number) {
    if (!mesh || busy) return;
    const current = selectedPlateIds(mesh);
    const plates = current.includes(plate) ? current.filter((id) => id !== plate) : [...current, plate];
    if (plates.length === 0) {
      setError(t("Select at least one plate for this product."));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { analyzeMesh, parseMeshFile } = await import('../../utils/mesh');
      // A saved product's file is downloaded once; a fresh upload is still in memory.
      const data = fileData ?? (await loadModelBuffer(mesh.url));
      setFileData(data);
      const geometry = parseMeshFile(data, { plates });
      const result = analyzeMesh(geometry);
      geometry.dispose();
      setAnalysis(result);
      setThumbnails(Object.fromEntries(result.plates.flatMap((p) => (p.thumbnail ? [[p.id, p.thumbnail]] : []))));
      onPlateChanged(plates, result);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files[0]);
  }

  return (
    <section className="card">
      <h2>{t("3D model (STL or 3MF)")}</h2>
      <p className="muted card__intro">{t("Shown in the product preview instead of the generic shape. The model's dimensions are read from the file, with Z pointing up as in slicers. 3MF files carry their own units; STL has none, so millimeters are assumed.")}</p>

      {mesh ? (
        <div className="model-file">
          <span className="model-file__badge" aria-hidden="true">
            {mesh.format.toUpperCase()}
          </span>
          <div className="model-file__info">
            <strong>{mesh.fileName}</strong>
            <span className="muted">
              {formatBytes(mesh.sizeBytes)} · {mesh.triangleCount.toLocaleString(LOCALE)} {t("triangles")}{busy && t(" · reading new file…")}
            </span>
          </div>
          <div className="model-file__actions">
            <button type="button" className="btn btn--small btn--ghost" onClick={() => inputRef.current?.click()}>{t("Replace")}</button>
            <button
              type="button"
              className="btn btn--small btn--ghost btn--danger"
              onClick={() => {
                setAnalysis(null);
                setFileData(null);
                setThumbnails({});
                onRemove();
              }}
            >{t("Remove")}</button>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        >
          {busy ? (
            t("Reading model…")
          ) : (
            <>{t("Drop an STL or 3MF file here or")} <u>{t("browse")}</u>
              <small>{t("STL (binary or ASCII) or 3MF, up to")} {formatBytes(MODEL_MAX_UPLOAD_BYTES)}</small>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".stl,.3mf,model/stl,application/sla,model/3mf,application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {error && <p className="field__help is-error">{error}</p>}

      {mesh && mesh.plates.length > 1 && (
        <div className="plate-picker">
          <h3>{t("Included plates")}</h3>
          <p className="muted">{t("Select the plates sold together as one product. All selected plates are shown to customers. Dimensions use the largest extent on each axis; volume and price cover the complete set.")}</p>
          <div className="plate-picker__options" role="group" aria-label={t("Included plates")}>
            {mesh.plates.map((plate) => (
              <button
                key={plate.id}
                type="button"
                aria-pressed={selectedPlateIds(mesh).includes(plate.id)}
                className={`plate-option ${selectedPlateIds(mesh).includes(plate.id) ? 'is-selected' : ''}`}
                onClick={() => void choosePlate(plate.id)}
                disabled={busy}
              >
                {thumbnails[plate.id] ? (
                  <img src={thumbnails[plate.id]} alt="" />
                ) : (
                  <span className="plate-option__placeholder" aria-hidden="true">
                    {plate.id}
                  </span>
                )}
                <span className="plate-option__name">{plate.name}</span>
                <span className="muted">
                  {formatCount('object', plate.objectCount)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mesh && mesh.parts.length > 0 && (
        <div className="model-parts">
          <h3>{t("Color parts from the file")}</h3>
          <p className="muted">{t("The preview starts in these colors, and customers can change each part to any of your filament colors. Name the parts so customers know what they're coloring.")}</p>
          {mesh.parts.map((part, i) => (
            <label key={part.key} className="model-part">
              <span className="model-part__swatch" style={{ background: part.fileColor }} title={part.fileColor} />
              <input
                value={part.name}
                onChange={(e) => onRenamePart(part.key, e.target.value)}
                aria-label={t("Name of color part {0}", i + 1)}
                placeholder={t("Part {0}", i + 1)}
              />
              <code className="model-part__hex">{part.fileColor.toUpperCase()}</code>
            </label>
          ))}
        </div>
      )}

      {analysis && (
        <div className="banner banner--info model-analysis">
          <p>{t("Model dimensions set from")} {mesh && selectedPlateIds(mesh).length > 1 ? t("the selected plate set (maximum per axis)") : analysis.plate !== null ? t("plate “{0}”", plateName(analysis)) : t("the file")}:{' '}
            <strong>{formatDimensions(analysis)}</strong>.
          </p>
          {analysis.volumeCm3 > 0 ? (
            <p>{t("Solid volume of the mesh:")} <strong>{formatVolume(analysis.volumeCm3)}</strong>{' '}
              {analysis.volumeCm3 === currentVolumeCm3 ? (
                <span className="muted">{t("(used as the model volume)")}</span>
              ) : (
                <button type="button" className="btn btn--small" onClick={() => onUseVolume(analysis.volumeCm3)}>{t("Use as model volume")}</button>
              )}
            </p>
          ) : (
            <p>{t("The mesh isn't closed, so its volume can't be measured — enter the volume from your slicer.")}</p>
          )}
          <p className="muted">{t("Prints usually use less material than the solid volume (infill, hollow walls). If your slicer reports the filament volume, that's more accurate for pricing.")}</p>
          {analysis.ignoredColorCount !== undefined && (
            <p>{t("This file uses")} {analysis.ignoredColorCount} {t("colors — too many to offer per-part choices, so it's shown in a single filament color that customers pick.")}</p>
          )}
        </div>
      )}
    </section>
  );
}
