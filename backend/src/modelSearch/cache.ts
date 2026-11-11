/** Small in-memory cache with expiry and least-recently-used eviction. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();

  constructor(private readonly maxEntries: number, private readonly ttlMs: number, private readonly now = Date.now) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}
