import type { CveSource } from './sources';
import { CVE_SOURCE_VALUES } from './sources';

export interface CveObservationFields {
  source: CveSource,
  cvss: number | null,
  cvssVector: string | null,
  cvssV2UserInteractionRequired: boolean | null,
  cvssUpdatedAt: Date | null,
  cwe: Array<string> | null,
  title: string | null,
  description: string | null,
  epss: number | null,
  epssUpdatedAt: Date | null,
  kev: boolean | null,
  kevUpdatedAt: Date | null,
  kevRequiredAction: string | null,
  kevDueDate: Date | null,
  kevNotes: string | null,
  kevRansomwareUse: string | null,
}

/**
 * The `cve` columns the observations settle. A column left `undefined` is one no source states,
 * which the write keeps at its stored value.
 */
export interface ResolvedCveFields {
  cvss?: number,
  /** `null` with a `cvss`: the score of a source that states no vector. */
  cvssVector?: string | null,
  cvssV2UserInteractionRequired?: boolean,
  cvssUpdatedAt?: Date | null,
  cwe?: Array<string>,
  cveTitle?: string,
  cveDescription?: string,
  epss?: number,
  epssUpdatedAt?: Date,
  kev?: boolean,
  kevUpdatedAt?: Date | null,
  kevRequiredAction?: string | null,
  kevDueDate?: Date | null,
  kevNotes?: string | null,
  kevRansomwareUse?: string | null,
}

const VECTOR_ORDER: ReadonlyArray<CveSource> = ['nvd', 'microsoft_defender'];
const CWE_SOURCES: ReadonlyArray<CveSource> = ['nvd'];
const TITLE_ORDER: ReadonlyArray<CveSource> = ['nvd', 'cisa_kev'];
const DESCRIPTION_ORDER: ReadonlyArray<CveSource> = ['nvd', 'microsoft_defender'];
const KEV_LISTING_SOURCE: CveSource = 'cisa_kev';

const SPECIFIC_CWE = /^CWE-\d+$/;

const CVSS_VERSION_PREFIX = /^CVSS:(\d\.\d)\//;

/** A vector without a `CVSS:` prefix is a 2.0 one, the only version that never carried it. */
export const cvssVersionOf = (vector: string): string => CVSS_VERSION_PREFIX.exec(vector)?.[1] ?? '2.0';

const ranked = (observations: ReadonlyArray<CveObservationFields>, order: ReadonlyArray<CveSource>) =>
  order.flatMap((source) => observations.filter((o) => o.source === source));

const firstStated = <T>(
  observations: ReadonlyArray<CveObservationFields>,
  order: ReadonlyArray<CveSource>,
  read: (o: CveObservationFields) => T | null,
): T | undefined => {
  for (const observation of ranked(observations, order)) {
    const value = read(observation);
    if (value !== null) {
      return value;
    }
  }
  return undefined;
};

const resolveScore = (observations: ReadonlyArray<CveObservationFields>): Pick<ResolvedCveFields, 'cvss' | 'cvssVector' | 'cvssV2UserInteractionRequired' | 'cvssUpdatedAt'> => {
  const inOrder = ranked(observations, VECTOR_ORDER);
  const tuple = inOrder.find((o) => o.cvssVector !== null && o.cvss !== null)
    ?? inOrder.find((o) => o.cvss !== null);
  if (tuple === undefined || tuple.cvss === null) {
    return {};
  }
  return {
    cvss: tuple.cvss,
    cvssVector: tuple.cvssVector,
    cvssV2UserInteractionRequired: tuple.cvssV2UserInteractionRequired ?? undefined,
    cvssUpdatedAt: tuple.cvssUpdatedAt,
  };
};

/** The other sources' ids count only when none of `CWE_SOURCES` names a specific weakness. */
const resolveCwe = (observations: ReadonlyArray<CveObservationFields>): Array<string> | undefined => {
  const union = (from: ReadonlyArray<CveObservationFields>) =>
    [...new Set(from.flatMap((o) => o.cwe ?? []).filter((id) => SPECIFIC_CWE.test(id)))];
  const primary = union(ranked(observations, CWE_SOURCES));
  if (primary.length > 0) {
    return primary;
  }
  const fallback = union(ranked(observations, CVE_SOURCE_VALUES.filter((s) => !CWE_SOURCES.includes(s))));
  return fallback.length > 0 ? fallback : undefined;
};

const resolveEpss = (observations: ReadonlyArray<CveObservationFields>): Pick<ResolvedCveFields, 'epss' | 'epssUpdatedAt'> => {
  let latest: { epss: number, epssUpdatedAt: Date } | undefined;
  for (const o of ranked(observations, CVE_SOURCE_VALUES)) {
    if (o.epss !== null && o.epssUpdatedAt !== null && (latest === undefined || o.epssUpdatedAt > latest.epssUpdatedAt)) {
      latest = { epss: o.epss, epssUpdatedAt: o.epssUpdatedAt };
    }
  }
  return latest ?? {};
};

/**
 * CISA's listing, else a connector's exploit-available flag, which only ever sets `kev`: what
 * reads as listed is `kev_updated_at`, which only CISA dates.
 */
const resolveKev = (observations: ReadonlyArray<CveObservationFields>): Pick<ResolvedCveFields, 'kev' | 'kevUpdatedAt' | 'kevRequiredAction' | 'kevDueDate' | 'kevNotes' | 'kevRansomwareUse'> => {
  const listing = observations.find((o) => o.source === KEV_LISTING_SOURCE && o.kev !== null);
  if (listing?.kev != null) {
    return {
      kev: listing.kev,
      kevUpdatedAt: listing.kevUpdatedAt,
      kevRequiredAction: listing.kevRequiredAction,
      kevDueDate: listing.kevDueDate,
      kevNotes: listing.kevNotes,
      kevRansomwareUse: listing.kevRansomwareUse,
    };
  }
  const flag = firstStated(observations, CVE_SOURCE_VALUES.filter((s) => s !== KEV_LISTING_SOURCE), (o) => o.kev);
  return flag === undefined ? {} : { kev: flag };
};

/**
 * The fields in force for one CVE, from every observation it holds, whatever order they arrived in.
 *
 * The vector, its score and its date come from the highest-ranked source that states a vector; a
 * score with no vector stands only while no source states one.
 */
export const resolveCveFields = (observations: ReadonlyArray<CveObservationFields>): ResolvedCveFields => {
  const resolved: ResolvedCveFields = {
    ...resolveScore(observations),
    cwe: resolveCwe(observations),
    cveTitle: firstStated(observations, TITLE_ORDER, (o) => o.title),
    cveDescription: firstStated(observations, DESCRIPTION_ORDER, (o) => o.description),
    ...resolveEpss(observations),
    ...resolveKev(observations),
  };
  return Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined));
};
