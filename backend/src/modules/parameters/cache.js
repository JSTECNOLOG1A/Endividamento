const cache = new Map();
const DEFAULT_TTL_MS = 60_000;

function cacheKey({ groupId, userId, key, scope }) {
  return `parameter:${scope || "resolve"}:${groupId || ""}:${userId || ""}:${key}`;
}

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key, value, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateParameterCache({ groupId, userId, key }) {
  for (const scope of ["resolve", "GLOBAL", "TENANT", "USER"]) {
    cache.delete(cacheKey({ groupId, userId, key, scope }));
    cache.delete(cacheKey({ groupId, userId: null, key, scope }));
  }
  if (!key) {
    for (const k of cache.keys()) {
      if (groupId && k.includes(`:${groupId}:`)) cache.delete(k);
    }
  }
}

export { cacheKey };
