interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export async function withCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = store.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }
  const data = await fetcher();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}
