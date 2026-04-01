export class WorkingMemory {
  private store: Map<string, { value: unknown; addedAt: number; size: number }> = new Map();
  private totalSize: number = 0;
  private maxSize: number;

  constructor(maxSize: number = 50000) {
    this.maxSize = maxSize;
  }

  set(key: string, value: unknown): void {
    const size = estimateTokens(value);

    // Evict oldest entries if needed
    while (this.totalSize + size > this.maxSize && this.store.size > 0) {
      this.evictOldest();
    }

    // Remove old value if key exists
    if (this.store.has(key)) {
      this.totalSize -= this.store.get(key)!.size;
    }

    this.store.set(key, { value, addedAt: Date.now(), size });
    this.totalSize += size;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    const entry = this.store.get(key);
    if (entry) {
      this.totalSize -= entry.size;
      this.store.delete(key);
      return true;
    }
    return false;
  }

  clear(): void {
    this.store.clear();
    this.totalSize = 0;
  }

  entries(): Array<{ key: string; value: unknown }> {
    return [...this.store.entries()].map(([key, { value }]) => ({ key, value }));
  }

  get currentSize(): number {
    return this.totalSize;
  }

  get capacity(): number {
    return this.maxSize;
  }

  get utilizationPercent(): number {
    return Math.round((this.totalSize / this.maxSize) * 100);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, { addedAt }] of this.store) {
      if (addedAt < oldestTime) {
        oldestTime = addedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }
}

function estimateTokens(value: unknown): number {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil((str?.length ?? 0) / 4);
}
