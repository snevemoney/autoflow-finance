/** Collects query keys and flushes them together after `delay` ms of quiet. */
export class KeyBatcher {
  private keys = new Map<string, unknown[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private flush: (keys: unknown[][]) => void, private delay = 400) {}

  add(...keys: unknown[][]) {
    for (const k of keys) this.keys.set(JSON.stringify(k), k);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), this.delay);
  }

  run() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = [...this.keys.values()];
    this.keys.clear();
    if (batch.length) this.flush(batch);
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.keys.clear();
  }
}

