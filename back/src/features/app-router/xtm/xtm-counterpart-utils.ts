/**
 * Cross-product awareness between the XTM products (OpenCTI, OpenAEV, OpenCRQ): which object of a
 * connected product is the same thing as one of ours, matched on a real identifier.
 *
 * The kinds, the key normalisation and the fact contract are the ones OpenCTI
 * (`modules/xtm/openaev/openaev-counterpart-domain.ts`) and OpenAEV (`io.openaev.xtm.counterpart`)
 * use, so the three products cache and compare the same keys.
 */

export const COUNTERPART_KINDS = ['ASSET', 'ATTACK_PATTERN', 'VULNERABILITY', 'THREAT'] as const;
export type CounterpartKind = typeof COUNTERPART_KINDS[number];

/**
 * The products an object is looked up in, in the emblem order of the contract (Sam, 23 Nov 2026):
 * XTM One first (its CTEM inventory), then OpenCTI and OpenAEV.
 */
export const COUNTERPART_PRODUCTS = ['xtmone', 'opencti', 'openaev'] as const;
export type CounterpartProduct = typeof COUNTERPART_PRODUCTS[number];

export interface XtmConnection {
  product: CounterpartProduct,
  connected: boolean,
  url: string | null,
}

export interface XtmCounterpartFact {
  key: string,
  value: string,
}

export interface XtmCounterpart {
  key: string,
  product: CounterpartProduct,
  objectId: string,
  objectType: string,
  objectName: string | null,
  objectUrl: string,
  facts: Array<XtmCounterpartFact>,
}

export const MAX_COUNTERPART_KEYS = 200;
export const COUNTERPART_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_KEY_LENGTH = 512;
const MAX_FACTS = 10;
const MAX_FACT_LENGTH = 64;
const FACT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/;
const MITRE_PATTERN = /^[TS]\d{4}(\.\d{3})?$|^(TA|M|G|S|C)\d{4}$/;
const STIX_ID_PATTERN = /^[a-z][a-z0-9-]*--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The key as the three products store it, or null when it can never match. */
export const normaliseCounterpartKey = (kind: CounterpartKind, key: string | null | undefined): string | null => {
  const trimmed = (key ?? '').trim();
  if (trimmed.length === 0 || trimmed.length > MAX_KEY_LENGTH) {
    return null;
  }
  switch (kind) {
    case 'ASSET':
      return trimmed.toLowerCase();
    case 'ATTACK_PATTERN': {
      const upper = trimmed.toUpperCase();
      return MITRE_PATTERN.test(upper) ? upper : null;
    }
    case 'VULNERABILITY': {
      const upper = trimmed.toUpperCase();
      return CVE_PATTERN.test(upper) ? upper : null;
    }
    case 'THREAT': {
      const lower = trimmed.toLowerCase();
      return STIX_ID_PATTERN.test(lower) ? lower : null;
    }
    default:
      return null;
  }
};

export const normaliseCounterpartKeys = (kind: CounterpartKind, keys: ReadonlyArray<string>): Array<string> => {
  const out = new Set<string>();
  for (const key of keys) {
    const normalised = normaliseCounterpartKey(kind, key);
    if (normalised) {
      out.add(normalised);
    }
    if (out.size >= MAX_COUNTERPART_KEYS) {
      break;
    }
  }
  return [...out];
};

/** A plain object answered by another product, read field by field without trusting its shape. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The facts a product answered, kept only when well formed and short: they are shown as is. */
export const sanitiseFacts = (facts: unknown): Array<XtmCounterpartFact> => {
  if (!Array.isArray(facts)) {
    return [];
  }
  const out: Array<XtmCounterpartFact> = [];
  for (const fact of facts.filter(isRecord)) {
    const key = fact.fact_key ?? fact.key;
    const value = fact.fact_value ?? fact.value;
    if (typeof key === 'string' && typeof value === 'string' && FACT_KEY_PATTERN.test(key)
      && key.length <= MAX_FACT_LENGTH && value.length > 0 && value.length <= MAX_FACT_LENGTH) {
      out.push({ key, value });
    }
    if (out.length >= MAX_FACTS) {
      break;
    }
  }
  return out;
};

/** A link a product answered is followed by the reader's browser: only http(s), never a script URL. */
export const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * One connected XTM product able to resolve counterparts for one tenant. A product registers one
 * provider; the resolver below knows nothing of any product.
 */
export interface CounterpartProvider {
  product: CounterpartProduct,
  url: string | null,
  isConnected: boolean,
  supports: (kind: CounterpartKind) => boolean,
  resolve: (kind: CounterpartKind, keys: Array<string>) => Promise<Array<XtmCounterpart>>,
}

interface CacheEntry { at: number, value: XtmCounterpart | null }

/**
 * Short-TTL cache per tenant, reader, product, kind and key: a found counterpart or a known miss
 * (null). The lookups run with the reader's own identity, so the answer depends on the reader and
 * is never served to another one (opencrq #24).
 */
const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 20_000;
const cacheKey = (tenantId: string, readerId: string, product: string, kind: CounterpartKind, key: string) =>
  `${tenantId}|${readerId}|${product}|${kind}|${key}`;

export const resetCounterpartCache = () => cache.clear();

/**
 * A product's lookup chains its reader's authorization (a token exchange, OpenCTI's public URL)
 * and the lookup itself, each with its own timeout: the budget bounds the whole chain.
 */
const COUNTERPART_PROVIDER_BUDGET_MS = 5_000;

/** The work's answer, or `null` once `ms` elapsed first; the work itself keeps running. */
export const withinBudget = async <T>(work: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Batched, cached and silent: one call per product for the keys the cache does not hold, the
 * products asked at once and each given `budgetMs`, so the page waits that long at most, and a
 * product that fails or runs past its budget answers nothing rather than failing the page, but is
 * named in `unavailable`. An answer past the budget is cached when it arrives, for the next page.
 */
export const resolveCounterparts = async (
  tenantId: string,
  readerId: string,
  kind: CounterpartKind,
  keys: ReadonlyArray<string>,
  providers: ReadonlyArray<CounterpartProvider>,
  now: () => number = Date.now,
  budgetMs: number = COUNTERPART_PROVIDER_BUDGET_MS,
): Promise<{ counterparts: Array<XtmCounterpart>, unavailable: Array<CounterpartProduct> }> => {
  const normalised = normaliseCounterpartKeys(kind, keys);
  if (normalised.length === 0) {
    return { counterparts: [], unavailable: [] };
  }
  const resolveWith = async (provider: CounterpartProvider): Promise<{ results: Array<XtmCounterpart>, failed: boolean }> => {
    if (!provider.supports(kind) || !provider.isConnected) {
      return { results: [], failed: false };
    }
    const results: Array<XtmCounterpart> = [];
    const missing: Array<string> = [];
    for (const key of normalised) {
      const entry = cache.get(cacheKey(tenantId, readerId, provider.product, kind, key));
      if (entry && now() - entry.at < COUNTERPART_CACHE_TTL_MS) {
        if (entry.value) {
          results.push(entry.value);
        }
      } else {
        missing.push(key);
      }
    }
    if (missing.length === 0) {
      return { results, failed: false };
    }
    const store = (found: Array<XtmCounterpart>): Array<XtmCounterpart> => {
      const byKey = new Map(found.filter((c) => isHttpUrl(c.objectUrl)).map((c) => [c.key, c]));
      const at = now();
      if (cache.size + missing.length > MAX_CACHE_ENTRIES) {
        cache.clear();
      }
      const stored: Array<XtmCounterpart> = [];
      for (const key of missing) {
        const value = byKey.get(key) ?? null;
        cache.set(cacheKey(tenantId, readerId, provider.product, kind, key), { at, value });
        if (value) {
          stored.push(value);
        }
      }
      return stored;
    };
    let found: Array<XtmCounterpart> | null;
    try {
      found = await withinBudget(provider.resolve(kind, missing).then(store), budgetMs);
    } catch {
      found = null;
    }
    if (found === null) {
      // A pivot is never worth a page error, and a failure or an overrun is not cached as a miss.
      return { results, failed: true };
    }
    return { results: [...results, ...found], failed: false };
  };
  const answers = await Promise.all(providers.map(resolveWith));
  return {
    counterparts: answers.flatMap((answer) => answer.results),
    unavailable: providers.filter((_, index) => answers[index]?.failed).map((provider) => provider.product),
  };
};

export const xtmConnections = (providers: ReadonlyArray<CounterpartProvider>): Array<XtmConnection> =>
  providers.map((p) => ({ product: p.product, connected: p.isConnected, url: p.isConnected ? p.url : null }));
