/** A DNS name: labels of letters, digits and inner hyphens, dot-separated (`web-01`, `app.corp.example`). */
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

/** The sources whose asset id another XTM product holds as a source reference (`openaev:<asset id>`). */
const REFERENCED_SOURCES: ReadonlySet<string> = new Set(['openaev', 'opencti']);

export interface AssetKeySource {
  source: string | null,
  sourceAssetId: string,
}

export interface AssetKeyInput {
  name: string | null,
  derivedName?: string | null,
  url?: string | null,
  properties?: unknown,
  sources: ReadonlyArray<AssetKeySource>,
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);

const texts = (value: unknown): Array<string> => (Array.isArray(value) ? value.map(text).filter((v): v is string => v !== null) : []);

const property = (properties: unknown, key: string): unknown => (
  typeof properties === 'object' && properties !== null ? Object.getOwnPropertyDescriptor(properties, key)?.value : undefined
);

const urlHost = (url: string | null | undefined): string | null => {
  const value = text(url);
  if (!value) {
    return null;
  }
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname || null;
  } catch {
    return null;
  }
};

const asHostName = (value: string | null | undefined): string | null => {
  const candidate = text(value);
  return candidate && HOST_NAME.test(candidate) ? candidate : null;
};

/**
 * Every key another XTM product may hold for this asset, strongest first: the source reference of
 * each source row another product imports (`openaev:<asset id>`), the hostname, the name and the
 * URL host when they read as DNS names, the seen IP, the IPs and the MACs. A web application or a
 * cloud resource has no hostname property, so its name and its source reference are what find it.
 */
export const assetCounterpartKeys = (asset: AssetKeyInput): Array<string> => {
  const keys: Array<string | null> = [
    ...asset.sources
      .filter((s) => s.source !== null && REFERENCED_SOURCES.has(s.source) && s.sourceAssetId.trim().length > 0)
      .map((s) => `${s.source}:${s.sourceAssetId.trim()}`),
    asHostName(text(property(asset.properties, 'hostname'))),
    asHostName(asset.name),
    asHostName(asset.derivedName),
    urlHost(asset.url),
    text(property(asset.properties, 'seenIp')),
    ...texts(property(asset.properties, 'ipAddresses')),
    ...texts(property(asset.properties, 'macAddresses')),
  ];
  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const key of keys) {
    if (key && !seen.has(key.toLowerCase())) {
      seen.add(key.toLowerCase());
      out.push(key);
    }
  }
  return out;
};
