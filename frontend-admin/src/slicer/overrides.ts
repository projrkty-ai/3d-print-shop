/** Parse "key = value" lines (Orca option overrides); blank lines and # comments are ignored. */
export function parseOverrides(text: string): { overrides: Record<string, string>; invalidLines: number[] } {
  const overrides: Record<string, string> = {};
  const invalidLines: number[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (!/^[a-z0-9_]+$/i.test(key)) { invalidLines.push(index + 1); return; }
    overrides[key] = line.slice(eq + 1).trim();
  });
  return { overrides, invalidLines };
}

/** "1h 28m 40s" style duration (exact, unlike Orca's truncated "1h28m"). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const parts = [d ? `${d}d` : '', d || h ? `${h}h` : '', d || h || m ? `${m}m` : '', `${r}s`].filter(Boolean);
  return parts.join(' ');
}
