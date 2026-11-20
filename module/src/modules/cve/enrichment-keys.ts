/**
 * Identity of an enrichment row by its CVE row and its whole tuple of values, shared by the stored
 * row (nullable columns read back as `null`) and the one a feed states (an absent field is
 * `undefined`): both spellings of "nothing" give the same key, while a null `tags` and an empty
 * one stay apart.
 */
export const referenceKey = (reference: {
  cveId: string,
  url: string,
  source?: string | null,
  tags?: ReadonlyArray<string> | null,
}): string => JSON.stringify([reference.cveId, reference.url, reference.source ?? null, reference.tags ?? null]);

export const affectedVersionKey = (version: {
  cveId: string,
  vendor?: string | null,
  product?: string | null,
  affectedFrom?: string | null,
  affectedUpTo: string,
  affectedUpToIncluded?: boolean,
}): string => JSON.stringify([
  version.cveId,
  version.vendor ?? null,
  version.product ?? null,
  version.affectedFrom ?? null,
  version.affectedUpTo,
  version.affectedUpToIncluded ?? false,
]);
