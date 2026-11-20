export interface VulnerableSoftwareVersion {
  vendor: string | null,
  name: string,
  version: string,
}

export interface VulnerableProduct {
  /** Null when the source names none, or names the product itself. */
  vendor: string | null,
  name: string,
  versions: Array<string>,
}

const versionOrder = new Intl.Collator('en', { numeric: true });

/** A source's lower snake case name made readable, nothing more: `chrome_for_mac` reads "Chrome for mac". */
export const softwareDisplayName = (raw: string): string => {
  const spaced = raw.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** One line per product, its versions in release order, products in the order of their names. */
export const groupVulnerableSoftware = (rows: ReadonlyArray<VulnerableSoftwareVersion>): Array<VulnerableProduct> => {
  const products = new Map<string, { vendor: string | null, name: string, versions: Set<string> }>();
  for (const row of rows) {
    const vendor = row.vendor === null || row.vendor === row.name ? null : softwareDisplayName(row.vendor);
    const name = softwareDisplayName(row.name);
    const key = JSON.stringify([vendor, name]);
    const product = products.get(key) ?? { vendor, name, versions: new Set<string>() };
    product.versions.add(row.version);
    products.set(key, product);
  }
  return [...products.values()]
    .map((product) => ({ ...product, versions: [...product.versions].sort(versionOrder.compare) }))
    .sort((a, b) => versionOrder.compare(a.name, b.name) || versionOrder.compare(a.vendor ?? '', b.vendor ?? ''));
};
