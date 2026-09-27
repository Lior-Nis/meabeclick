const store = globalThis as unknown as { __meabeclick?: Map<string, unknown> };
store.__meabeclick ??= new Map();

/** Survives Vite HMR module re-evaluation in dev; a plain call in production. */
export function singleton<T>(key: string, make: () => T): T {
  const cache = store.__meabeclick!;
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}
