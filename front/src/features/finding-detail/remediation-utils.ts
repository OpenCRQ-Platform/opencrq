export interface AffectedVersion {
  vendor: string | null,
  product: string | null,
  affectedFrom: string | null,
  affectedUpTo: string,
  affectedUpToIncluded: boolean,
}

export interface RemediationReference {
  url: string,
  source: string | null,
  tags: Array<string> | null,
  /** True for a URL the KEV catalogue published in its notes, which no other feed carries. */
  fromCisa: boolean,
}

export interface ComponentFix {
  key: string,
  vendor: string | null,
  product: string | null,
  /** What to show as the component: the product when the CNA named one, else the vendor. */
  name: string | null,
  /** The first fixed version, set only where the ranges name exactly one. */
  targetVersion: string | null,
  /** The CNA's own upgrade sentences naming this component. */
  vendorLines: Array<string>,
  references: Array<RemediationReference>,
}

export interface Remediation {
  components: Array<ComponentFix>,
  /**
   * Vendor prose no component claimed, which is every line when the feed stated no version range.
   *
   * The prose is often the only place a fixed version is named, so it is reported on its own rather
   * than dropped with the component that never existed to carry it.
   */
  unassignedVendorLines: Array<string>,
  /** Fix references naming no component of this CVE. */
  leads: Array<RemediationReference>,
  rest: Array<RemediationReference>,
}

/** Tags the NVD analysis pass puts on a reference that speaks about a fix rather than about the flaw. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- feed values matched against, never displayed
const FIX_TAGS = new Set(['Patch', 'Vendor Advisory', 'Release Notes', 'Mitigation']);

const URL_IN_TEXT = /https?:\/\/[^\s\]),]+/g;

/** CISA closes every note with the NVD record, which is the page the reader already came from. */
const isNvdRecord = (url: string): boolean => url.includes('nvd.nist.gov/vuln/detail');

/**
 * A reference label, since no feed publishes a reference title.
 *
 * Host plus path, because a bare host collapses the four GitHub references of one CVE into four
 * identical rows. Query and fragment are dropped: they carry ids no reader reads.
 *
 * Falls back to the raw string for anything `URL` cannot read, so a malformed reference still
 * renders as itself rather than disappearing.
 */
export const referenceLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return path === '' ? host : `${host}${path}`;
  } catch {
    return url;
  }
};

/**
 * The URLs the KEV catalogue published for one entry.
 *
 * The field is prose, not a list: CISA separates entries with a semicolon, a comma or a full
 * sentence, and closes on the NVD record every time. Only the URLs survive, the NVD one excluded.
 */
export const kevNoteUrls = (notes: string | null | undefined): Array<string> => {
  if (!notes) {
    return [];
  }
  const seen = new Set<string>();
  for (const match of notes.matchAll(URL_IN_TEXT)) {
    const url = match[0].replace(/[.,;]+$/, '');
    if (!isNvdRecord(url)) {
      seen.add(url);
    }
  }
  return [...seen];
};

export type ActionSegment =
  | { kind: 'text', value: string }
  | { kind: 'link', value: string };

/**
 * The required action split so its URLs can be clicked without rewording the sentence.
 *
 * The catalogue writes the vendor's page inside the instruction rather than beside it, in brackets
 * on some entries and bare on others, so the sentence has to keep its shape and gain links in place.
 */
export const splitRequiredAction = (action: string): Array<ActionSegment> => {
  const segments: Array<ActionSegment> = [];
  let cursor = 0;
  for (const match of action.matchAll(URL_IN_TEXT)) {
    const start = match.index;
    const raw = match[0];
    const url = raw.replace(/[.,;]+$/, '');
    if (start > cursor) {
      segments.push({ kind: 'text', value: action.slice(cursor, start) });
    }
    segments.push({ kind: 'link', value: url });
    cursor = start + url.length;
  }
  if (cursor < action.length) {
    segments.push({ kind: 'text', value: action.slice(cursor) });
  }
  return segments;
};

const componentKey = (vendor: string | null, product: string | null): string =>
  `${vendor?.trim() ?? ''}|${product?.trim() ?? ''}`;

/**
 * The version to move to, when the ranges name exactly one.
 *
 * An excluded bound is the first version carrying the fix; an included one only says the fix lands
 * somewhere after it. A vendor maintaining several release lines states several first-fixed
 * versions at once, and picking one of them would send a reader to a version that fixes nothing on
 * their line, so the card names none and lets the vendor's own sentence speak.
 */
const readTargetVersion = (versions: Array<AffectedVersion>): string | null => {
  const fixed = new Set(versions.filter((v) => !v.affectedUpToIncluded).map((v) => v.affectedUpTo));
  return fixed.size === 1 ? [...fixed][0] : null;
};

/**
 * The vendor's upgrade sentences naming one component.
 *
 * A CNA covering several products puts the product name in every sentence, which is the only thing
 * that tells them apart. A CVE with a single component is the opposite case: the sentence names no
 * product because there is nothing to disambiguate, so it all belongs to that component.
 */
const linesForComponent = (
  lines: Array<string>,
  product: string | null,
  soleComponent: boolean,
): Array<string> => {
  if (soleComponent) {
    return lines;
  }
  const token = product?.trim().toLowerCase();
  if (!token) {
    return [];
  }
  return lines.filter((line) => line.toLowerCase().includes(token));
};

/** Records what a component took, so what no component took can be reported rather than lost. */
const claimLines = (lines: Array<string>, claimed: Set<string>): Array<string> => {
  lines.forEach((line) => claimed.add(line));
  return lines;
};

/** Lowercase alphanumerics only, so a product name meets a url that punctuates it differently. */
const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Below four characters a word matches by accident more often than on purpose. */
const MIN_PRODUCT_TOKEN = 4;

/**
 * True where a reference speaks about this component rather than about the flaw.
 *
 * Matching is on the product name alone. The vendor name cannot be used: one vendor commonly ships
 * several affected components, so a vendor match binds every one of its pages to every one of its
 * products, and drags in any press article that names the vendor too.
 *
 * The product is matched word by word rather than whole, because a CNA writes names a url cannot
 * carry: `NetScaler ADC` appears in no host, `netscaler` appears in its vendor's.
 */
const referenceNamesComponent = (url: string, product: string | null): boolean => {
  const tokens = (product ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length >= MIN_PRODUCT_TOKEN)
    .map(compact);
  if (tokens.length === 0) {
    return false;
  }
  const haystack = compact(url);
  return tokens.some((token) => haystack.includes(token));
};

const isFixReference = (reference: RemediationReference): boolean =>
  reference.fromCisa || (reference.tags ?? []).some((tag) => FIX_TAGS.has(tag));

/** Host and path, which is what makes a KEV note URL and an NVD reference the same page. */
const samePageKey = (url: string): string => referenceLabel(url).toLowerCase();

/**
 * Every reference of one CVE, the KEV notes included, each carrying where it came from.
 *
 * A note URL pointing at a page the NVD already published is dropped rather than listed twice: the
 * two feeds routinely differ by a query string on the same vendor page.
 */
export const collectReferences = (
  references: Array<{ url: string, source: string | null, tags: Array<string> | null }>,
  kevNotes: string | null | undefined,
): Array<RemediationReference> => {
  const collected: Array<RemediationReference> = references.map((reference) => ({ ...reference, fromCisa: false }));
  const known = new Set(collected.map((reference) => samePageKey(reference.url)));
  for (const url of kevNoteUrls(kevNotes)) {
    if (!known.has(samePageKey(url))) {
      known.add(samePageKey(url));
      collected.push({ url, source: null, tags: null, fromCisa: true });
    }
  }
  return collected;
};

/**
 * The whole Remediation reading of one CVE: what to move to per component, and where each reference
 * belongs.
 *
 * Affected ranges never reach the surface. They are read for the version they name and for nothing
 * else: which release line a given machine runs is a question for the vendor advisory, and the
 * product holds no installed version to answer it with.
 */
export const readRemediation = (input: {
  affectedVersions: Array<AffectedVersion>,
  references: Array<{ url: string, source: string | null, tags: Array<string> | null }>,
  kevNotes: string | null | undefined,
  vendorSolution: string | null | undefined,
}): Remediation => {
  const grouped = new Map<string, Array<AffectedVersion>>();
  for (const version of input.affectedVersions) {
    const key = componentKey(version.vendor, version.product);
    grouped.set(key, [...(grouped.get(key) ?? []), version]);
  }

  const solutionLines = (input.vendorSolution ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const collected = collectReferences(input.references, input.kevNotes);
  const fixReferences = collected.filter(isFixReference);
  const matched = new Set<string>();

  const claimedLines = new Set<string>();
  const components = [...grouped.entries()].map(([key, versions]) => {
    const vendor = versions[0].vendor?.trim() || null;
    const product = versions[0].product?.trim() || null;
    const references = fixReferences.filter((reference) => referenceNamesComponent(reference.url, product));
    for (const reference of references) {
      matched.add(reference.url);
    }
    return {
      key,
      vendor,
      product,
      name: product ?? vendor,
      targetVersion: readTargetVersion(versions),
      vendorLines: claimLines(linesForComponent(solutionLines, product, grouped.size === 1), claimedLines),
      references,
    };
  });

  return {
    components,
    unassignedVendorLines: solutionLines.filter((line) => !claimedLines.has(line)),
    leads: fixReferences.filter((reference) => !matched.has(reference.url)),
    rest: collected.filter((reference) => !isFixReference(reference)),
  };
};

/**
 * The CISA KEV catalogue filtered down to one CVE.
 *
 * CISA publishes no per-entry page: the catalogue is a single table whose full-text filter is the
 * only way to point a reader at the row stating the required action.
 */
export const kevCatalogUrl = (cveId: string): string => `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(cveId)}`;
