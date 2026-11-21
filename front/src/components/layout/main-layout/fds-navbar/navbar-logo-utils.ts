export const OPENCTI_PRODUCT_URL = 'https://filigran.io/platform/opencti/';
export const OPENAEV_PRODUCT_URL = 'https://filigran.io/platform/openaev/';
export const XTM_HUB_URL = 'https://hub.filigran.io';

/**
 * Inside a tenant the logo opens that tenant's home: `/` only redirects to the first tenant, so
 * sending a reader there would take them through a tenant-less route and, with several tenants,
 * to another tenant than the one on screen. Outside a tenant (the platform surface) it keeps `/`.
 */
export const navbarLogoPath = (tenantId: string | undefined) => (tenantId ? `/${encodeURIComponent(tenantId)}` : '/');

interface ProductDestination {
  href: string,
  connected: boolean,
}

const toHttpUrl = (value: string | null): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

/** A connected platform opens itself, otherwise its product page, as in OpenAEV's switcher. */
export const productSwitcherDestinations = ({ openctiUrl, openaevUrl }: { openctiUrl: string | null, openaevUrl: string | null }): Record<'opencti' | 'openaev' | 'xtmHub', ProductDestination> => {
  const opencti = toHttpUrl(openctiUrl);
  const openaev = toHttpUrl(openaevUrl);
  return {
    opencti: { href: opencti ?? OPENCTI_PRODUCT_URL, connected: opencti !== null },
    openaev: { href: openaev ?? OPENAEV_PRODUCT_URL, connected: openaev !== null },
    xtmHub: { href: XTM_HUB_URL, connected: false },
  };
};
