import { formatCount, formatNumber, t } from '../../i18n';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import profiles from '../../slicer/engine/profiles.json';
import type { ProfilePreset } from '../../slicer/engine/index.mjs';
import { buildCatalog } from '../../slicer/profileCatalog';
import { createSlicerClient, SliceCancelledError, type SliceOutput, type SlicerClient } from '../../slicer/client';
import { formatDuration, parseOverrides } from '../../slicer/overrides';
import type { ModelInfo, SliceSettings, SupportChoice } from '../../slicer/protocol';
import { stageLabel } from '../../slicer/stages';
import { readFileBytes } from '../../utils/files';

const catalog = buildCatalog(profiles as ProfilePreset[]);
/** 0.4 mm nozzle printer first, as the most common choice */
const DEFAULT_PRINTER = catalog.printers.find((p) => p.includes('(0.4 nozzle)')) ?? catalog.printers[0] ?? '';
const ACCEPT = '.3mf,.stl';

const readBytes = readFileBytes;

const grams = (g: number) => `${formatNumber(g, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`;
const meters = (m: number) => `${formatNumber(m, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
const minutes = (s: number) => `${formatNumber(s / 60, { maximumFractionDigits: 1 })} min`;

interface Props {
  /** injectable for tests; defaults to the Web Worker client */
  createClient?: () => SlicerClient;
}

/** Admin tool: slice a model in the browser and show the estimated print time and filament. */
export function AdminSlicerPage({ createClient = createSlicerClient }: Props) {
  const clientRef = useRef<SlicerClient | null>(null);
  const getClient = () => (clientRef.current ??= createClient());
  useEffect(() => () => clientRef.current?.dispose(), []);

  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [printer, setPrinter] = useState(DEFAULT_PRINTER);
  const [processName, setProcessName] = useState(() => catalog.defaultProcess(DEFAULT_PRINTER) ?? '');
  const [filament, setFilament] = useState(() => catalog.defaultFilament(DEFAULT_PRINTER) ?? '');
  const [useProject, setUseProject] = useState(false);
  const [support, setSupport] = useState<SupportChoice>('off');
  const [plate, setPlate] = useState(1);
  const [copies, setCopies] = useState(1);
  const [scalePercent, setScalePercent] = useState(100);
  const [calibration, setCalibration] = useState(true);
  const [gcode, setGcode] = useState(false);
  const [overridesText, setOverridesText] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [output, setOutput] = useState<SliceOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processes = useMemo(() => catalog.processesFor(printer), [printer]);
  const filaments = useMemo(() => catalog.filamentsFor(printer), [printer]);
  const parsed = useMemo(() => parseOverrides(overridesText), [overridesText]);

  function changePrinter(next: string) {
    setPrinter(next);
    setProcessName(catalog.defaultProcess(next) ?? '');
    setFilament(catalog.defaultFilament(next) ?? '');
  }

  async function inspect(name: string, bytes: ArrayBuffer, plateNo: number) {
    setInfo(null);
    setFileError(null);
    try {
      const result = await getClient().inspect(bytes, name, plateNo);
      setInfo(result);
      if (!result.hasProjectSettings) setUseProject(false);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setOutput(null);
    setError(null);
    if (!f) { setFile(null); setInfo(null); return; }
    if (!/\.(3mf|stl)$/i.test(f.name)) {
      setFile(null);
      setInfo(null);
      setFileError(t('Choose a .3mf or .stl file.'));
      return;
    }
    const bytes = await readBytes(f);
    setFile({ name: f.name, bytes });
    setPlate(1);
    await inspect(f.name, bytes, 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || running || parsed.invalidLines.length) return;
    const settings: SliceSettings = {
      useProjectSettings: useProject && !!info?.hasProjectSettings,
      printer, process: processName, filament, support, plate, copies: Math.max(1, Math.min(100, Math.round(copies) || 1)),
      scale: Math.max(1, Math.min(1000, scalePercent || 100)) / 100,
      calibration, overrides: parsed.overrides, gcode,
    };
    setRunning(true);
    setError(null);
    setOutput(null);
    setProgress({ stage: 'slicing', fraction: 0 });
    try {
      const out = await getClient().slice(file.bytes, file.name, settings, (stage, fraction) => setProgress({ stage, fraction }));
      setOutput(out);
    } catch (err) {
      if (!(err instanceof SliceCancelledError)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function cancel() {
    clientRef.current?.cancel();
  }

  function downloadGcode() {
    if (!output?.gcode || !file) return;
    const blob = new Blob([output.gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace(/\.(3mf|stl)$/i, '') + '.gcode';
    a.click();
    URL.revokeObjectURL(url);
  }

  const r = output?.result;
  return (
    <div className="admin slicer">
      <div className="admin__header">
        <div>
          <h1>{t('Slicer test')}</h1>
          <p className="muted">{t('Slice a model in the browser with the bundled OrcaSlicer printer profiles to estimate the print time and filament use.')}</p>
        </div>
      </div>

      <form className="card" onSubmit={(e) => void handleSubmit(e)} aria-label={t('Slicing settings')}>
        <label className="field">
          <span>{t('Model file (.3mf or .stl)')}</span>
          <input type="file" accept={ACCEPT} onChange={(e) => void chooseFile(e)} disabled={running} />
          {fileError && <span className="field__help is-error" role="alert">{fileError}</span>}
        </label>
        {info && (
          <p className="muted slicer__model-info" data-testid="model-info">
            {formatCount('object', info.objects.length)}
            {info.painted && <> · {t('multi-colour painting')}</>}
            {info.plates.length > 1 && <> · {t('plates: {0}', info.plates.length)}</>}
            {info.hasProjectSettings && info.projectPrinter && <> · {t('project: {0}', info.projectPrinter)}</>}
          </p>
        )}

        {info?.hasProjectSettings && (
          <label className="checkbox slicer__row">
            <input type="checkbox" checked={useProject} onChange={(e) => setUseProject(e.target.checked)} disabled={running} />
            <span>{t('Use the settings saved in the 3MF project')}</span>
          </label>
        )}

        <div className="form-grid">
          <label className="field">
            <span>{t('Printer')}</span>
            <select value={printer} onChange={(e) => changePrinter(e.target.value)} disabled={running || useProject}>
              {catalog.printers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('Process')}</span>
            <select value={processName} onChange={(e) => setProcessName(e.target.value)} disabled={running || useProject}>
              {processes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('Filament')}</span>
            <select value={filament} onChange={(e) => setFilament(e.target.value)} disabled={running || useProject}>
              {filaments.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>

        <div className="form-grid form-grid--4">
          <label className="field">
            <span>{t('Supports')}</span>
            <select value={support} onChange={(e) => setSupport(e.target.value as SupportChoice)} disabled={running}>
              <option value="off">{t('Off')}</option>
              <option value="on">{t('On')}</option>
              <option value="profile">{t('As in the profile')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('Copies')}</span>
            <input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Number(e.target.value))} disabled={running} />
          </label>
          <label className="field">
            <span>{t('Scale (%)')}</span>
            <input type="number" min={1} max={1000} step={1} value={scalePercent} onChange={(e) => setScalePercent(Number(e.target.value))} disabled={running} />
          </label>
          {info && info.plates.length > 1 && (
            <label className="field">
              <span>{t('Plate')}</span>
              <select value={plate} onChange={(e) => setPlate(Number(e.target.value))} disabled={running}>
                {info.plates.map((p, i) => <option key={p.id} value={i + 1}>{p.name || t('Plate {0}', i + 1)}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="slicer__options">
          <label className="checkbox">
            <input type="checkbox" checked={calibration} onChange={(e) => setCalibration(e.target.checked)} disabled={running} />
            <span>{t('Apply the calibration (matched to OrcaSlicer reference prints)')}</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={gcode} onChange={(e) => setGcode(e.target.checked)} disabled={running} />
            <span>{t('Generate a downloadable G-code')}</span>
          </label>
        </div>

        <details className="slicer__advanced">
          <summary>{t('Setting overrides')}</summary>
          <label className="field">
            <span>{t('One OrcaSlicer option per line, e.g. sparse_infill_density = 25%')}</span>
            <textarea rows={4} value={overridesText} onChange={(e) => setOverridesText(e.target.value)} disabled={running} spellCheck={false} className="mono" />
            {parsed.invalidLines.length > 0 && (
              <span className="field__help is-error" role="alert">{t('Invalid lines: {0}. Use "key = value".', parsed.invalidLines.join(', '))}</span>
            )}
          </label>
        </details>

        <div className="slicer__actions">
          <button type="submit" className="btn btn--primary" disabled={!file || !!fileError || running || parsed.invalidLines.length > 0}>
            {running ? t('Slicing…') : t('Slice')}
          </button>
          {running && <button type="button" className="btn btn--ghost" onClick={cancel}>{t('Cancel')}</button>}
        </div>

        {progress && (
          <div className="slicer__progress" role="status">
            <progress value={Math.round(progress.fraction * 100)} max={100} />
            <span>{stageLabel(progress.stage)}</span>
          </div>
        )}
      </form>

      {error && <p className="banner banner--error" role="alert">{t('Slicing failed: {0}', error)}</p>}

      {r && (
        <section className="card slicer__result" aria-label={t('Estimate')}>
          <div className="card__header"><h2>{t('Estimate')}</h2></div>
          <dl className="slicer__summary">
            <div><dt>{t('Print time')}</dt><dd data-testid="result-time">{r.time}</dd><dd className="muted">{formatDuration(r.time_s)}</dd></div>
            <div><dt>{t('Filament')}</dt><dd data-testid="result-weight">{grams(r.weight_g)}</dd><dd className="muted">{meters(r.filament_length_m)}</dd></div>
            <div><dt>{t('Tool changes')}</dt><dd>{formatNumber(r.tool_changes)}</dd></div>
            <div><dt>{t('Layers')}</dt><dd>{formatNumber(r.layers)}</dd><dd className="muted">{t('first layer {0}', formatDuration(r.first_layer_time_s))}</dd></div>
          </dl>

          <div className="slicer__tables">
            <table className="admin-table">
              <caption>{t('Filament per extruder')}</caption>
              <thead><tr><th>{t('Extruder')}</th><th>{t('Weight')}</th><th>{t('Length')}</th></tr></thead>
              <tbody>
                {r.per_extruder.map((x) => (
                  <tr key={x.extruder}><td>{x.extruder}</td><td>{grams(x.weight_g)}</td><td>{meters(x.length_m)}</td></tr>
                ))}
              </tbody>
            </table>
            <table className="admin-table">
              <caption>{t('Weight breakdown')}</caption>
              <tbody>
                <tr><td>{t('Model')}</td><td>{grams(r.breakdown.weight_g.model)}</td></tr>
                <tr><td>{t('Support')}</td><td>{grams(r.breakdown.weight_g.support)}</td></tr>
                <tr><td>{t('Wipe tower')}</td><td>{grams(r.breakdown.weight_g.wipe_tower)}</td></tr>
                <tr><td>{t('Start/end G-code')}</td><td>{grams(r.breakdown.weight_g.custom_gcode)}</td></tr>
              </tbody>
            </table>
            <table className="admin-table">
              <caption>{t('Time breakdown')}</caption>
              <tbody>
                <tr><td>{t('Model')}</td><td>{minutes(r.breakdown.time_s.model)}</td></tr>
                <tr><td>{t('Support')}</td><td>{minutes(r.breakdown.time_s.support)}</td></tr>
                <tr><td>{t('Wipe tower')}</td><td>{minutes(r.breakdown.time_s.wipe_tower)}</td></tr>
                <tr><td>{t('Tool changes')}</td><td>{minutes(r.breakdown.time_s.tool_changes)}</td></tr>
                <tr><td>{t('Travel and retractions')}</td><td>{minutes(r.breakdown.time_s.travel_retract)}</td></tr>
                <tr><td>{t('Layer cooling slowdown')}</td><td>{minutes(r.breakdown.time_s.cooling_slowdown ?? 0)}</td></tr>
                <tr><td>{t('Start/end G-code')}</td><td>{minutes(r.breakdown.time_s.start_end_gcode)}</td></tr>
              </tbody>
            </table>
          </div>

          <p className="muted slicer__meta">
            {t('Printer: {0}', r.printer ?? '—')} · {t('Process: {0}', r.process ?? '—')} · {t('Supports: {0}', r.support ? t('On') : t('Off'))} · {t('Copies: {0}', r.copies)} · {t('Scale: {0}%', formatNumber((r.scale ?? 1) * 100))} · {t('Calibration: {0}', String(r.calibration.source))} · {t('Computed in {0}', formatDuration(r.elapsed_ms / 1000))}
          </p>
          {output?.gcode && (
            <button type="button" className="btn btn--ghost" onClick={downloadGcode}>{t('Download G-code')}</button>
          )}
        </section>
      )}
    </div>
  );
}

export default AdminSlicerPage;
