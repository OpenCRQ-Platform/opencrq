import { newError } from '@app/utils';
import type { AssetCategory, AssetCriticality, AssetSourceOrigin, AssetSubcategory } from './constants';
import type { SupportingAssetExposure } from './schema';
import type { AssetManualValue, AssetObservation, AssetObservationProperties } from './types';
import { ASSET_CRITICALITY_SEVERITY, SUBCATEGORY_TO_CATEGORY } from './constants';
import { deriveAssetName } from './derived-name';
import { sourceAuthorityRank } from './source-authority';

export interface ResolvedAssetAttributes {
  name: string | null,
  exposure: SupportingAssetExposure,
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
  criticality: AssetCriticality,
  description: string | null,
  externalReference: string | null,
  url: string | null,
  linkedPerson: string | null,
  firstSeenAt: Date | null,
  lastSeenAt: Date | null,
}

const EXPOSURE_SEVERITY: Record<SupportingAssetExposure, number> = {
  internet_facing: 2,
  internal: 1,
  unknown: 0,
};

const mostSevere = <T extends string>(values: ReadonlyArray<T>, severity: Record<T, number>): T =>
  values.reduce((best, value) => (severity[value] > severity[best] ? value : best));

/**
 * What every "which source wins" rule below reads. Narrower than `AssetObservation` so the same
 * ranking serves a reader holding only a source summary, never a second rule drifting from this one.
 */
export interface RankedObservation {
  source: string | null,
  /** What produced the observation — see `supportingAssetSources.origin` (schema.ts); ranks a manual entry ahead of every connector. */
  origin: AssetSourceOrigin,
  sourceAssetId: string,
  sourceLastActivityAt: Date,
}

/**
 * The last key each rule below falls back on, so none of them is decided by the order the rows
 * came back in: a batch writes its `supporting_asset_sources` rows in one transaction, where
 * `now()` is a single instant, making an exact `sourceLastActivityAt` tie an ordinary case. Negative
 * when `a` wins.
 */
const breakTie = (a: RankedObservation, b: RankedObservation): number => {
  const byAuthority = sourceAuthorityRank(a.source, a.origin) - sourceAuthorityRank(b.source, b.origin);
  if (byAuthority !== 0) {
    return byAuthority;
  }
  return a.sourceAssetId.localeCompare(b.sourceAssetId);
};

const activeMoreRecently = (o: RankedObservation, best: RankedObservation): boolean => {
  const byRecency = o.sourceLastActivityAt.getTime() - best.sourceLastActivityAt.getTime();
  return byRecency === 0 ? breakTie(o, best) < 0 : byRecency > 0;
};

/** The non-null value of the source active most recently, breaking ties the same way `name` does. */
const mostRecentlyActiveValue = <T>(
  observations: ReadonlyArray<AssetObservation>,
  getValue: (o: AssetObservation) => T | null,
): T | null => {
  const present = observations.filter((o) => getValue(o) !== null);
  if (present.length === 0) {
    return null;
  }
  return getValue(present.reduce((best, o) => (activeMoreRecently(o, best) ? o : best)));
};

/**
 * The single observation every authority-ranked, one-source-of-truth attribute reads off —
 * `categoryId` and `subcategoryId` share this winner so the pair never disagrees.
 */
const resolveWinner = <T extends RankedObservation>(observations: ReadonlyArray<T>): T =>
  observations.reduce((best, o) => {
    const bestRank = sourceAuthorityRank(best.source, best.origin);
    const rank = sourceAuthorityRank(o.source, o.origin);
    if (rank !== bestRank) {
      return rank < bestRank ? o : best;
    }
    // Tie on authority: the source active most recently wins, mirroring the `name` rule.
    return activeMoreRecently(o, best) ? o : best;
  });

/** Highest authority first, then most recently active, then a stable key. */
const byAuthorityThenRecency = (a: RankedObservation, b: RankedObservation): number => {
  const byAuthority = sourceAuthorityRank(a.source, a.origin) - sourceAuthorityRank(b.source, b.origin);
  if (byAuthority !== 0) {
    return byAuthority;
  }
  const byRecency = b.sourceLastActivityAt.getTime() - a.sourceLastActivityAt.getTime();
  return byRecency !== 0 ? byRecency : a.sourceAssetId.localeCompare(b.sourceAssetId);
};

const isReported = (value: unknown): boolean =>
  value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);

/**
 * The family-specific block that speaks for the asset as a whole, merged **field by field** rather
 * than taken whole from one winning source. A property block is a dozen fields, not one value, and
 * two connectors rarely report the same dozen: Defender reports no seen IP and no architecture at
 * all, so handing the block to the highest-authority source alone would blank two fields another
 * source did report. Each field goes to the highest-authority source that actually reports it, and
 * the connectors' address sets are unioned — an IP is an observation of the same machine whoever
 * saw it.
 *
 * Only blocks of the winning source's own family are merged: an asset whose sources disagree on
 * family is one the matcher should never have fused, and merging across families would hide that.
 *
 * A manual observation is one more source here, ranked ahead of every connector
 * (`sourceAuthorityRank`): a field the user typed by hand wins over the same field reported by a
 * connector, exactly as `manualValues` outranks a rule in `resolveAssetAttributes`.
 */
export const resolveObservationProperties = <T extends RankedObservation & { properties?: AssetObservationProperties }>(
  observations: ReadonlyArray<T>,
): AssetObservationProperties | null => {
  const carrying = observations.filter((o) => o.properties !== undefined);
  if (carrying.length === 0) {
    return null;
  }
  const family = resolveWinner(carrying).properties!.family;
  const ranked = [...carrying]
    .filter((o) => o.properties!.family === family)
    .sort(byAuthorityThenRecency);

  const merged: Record<string, unknown> = { ...ranked[0].properties };
  // A list typed by hand is a correction, not one more sighting: unioned with the connectors', an
  // address the user removed would come straight back.
  const typedByHand = new Set(ranked[0].origin === 'user' ? Object.keys(merged).filter((key) => isReported(merged[key])) : []);
  for (const { properties: block } of ranked.slice(1)) {
    for (const [key, value] of Object.entries(block!)) {
      const current = merged[key];
      if (Array.isArray(current) && Array.isArray(value)) {
        if (!typedByHand.has(key)) {
          merged[key] = [...new Set([...current, ...value])];
        }
      } else if (!isReported(current)) {
        merged[key] = value;
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- every block merged carries `family`, and only blocks of that one family are merged
  return merged as unknown as AssetObservationProperties;
};

/**
 * Reads every observation, the manual one included: a field typed by hand outranks a connector's
 * (`resolveObservationProperties`), where `resolveAssetAttributes` ignores that observation.
 */
export const resolveDerivedName = (observations: ReadonlyArray<AssetObservation>): string | null =>
  deriveAssetName(resolveObservationProperties(observations));

/**
 * A subcategory is only kept while it still belongs to the resolved category — whether that
 * subcategory was reported by a connector or pinned by hand. Pinning it is not an exemption from
 * this pairing: a hand-set category (or one a connector later changes) replaces the classification
 * the subcategory came with, and keeping a subcategory that no longer belongs to it would leave the
 * pair describing two different things.
 */
const subcategoryWithin = (subcategoryId: AssetSubcategory | null, categoryId: AssetCategory): AssetSubcategory | null => (
  subcategoryId !== null && SUBCATEGORY_TO_CATEGORY[subcategoryId] === categoryId ? subcategoryId : null
);

const earliest = (dates: ReadonlyArray<Date | null>): Date | null => {
  const present = dates.filter((d): d is Date => d !== null);
  return present.length === 0 ? null : new Date(Math.min(...present.map((d) => d.getTime())));
};

const latest = (dates: ReadonlyArray<Date | null>): Date | null => {
  const present = dates.filter((d): d is Date => d !== null);
  return present.length === 0 ? null : new Date(Math.max(...present.map((d) => d.getTime())));
};

const manualValueOf = <T extends string>(manualValues: ReadonlyArray<AssetManualValue>, attribute: AssetManualValue['attribute']): T | undefined =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- caller picks T to match the attribute it asked for; the stored value is always that attribute's own union
  manualValues.find((v) => v.attribute === attribute)?.value as T | undefined;

/**
 * One rule per attribute rather than one winning source. A value a user set by hand outranks
 * every rule below and is checked first, attribute by attribute. `criticalityLift` is the band the
 * asset takes from the identity it is assigned to, one more reading beside the connectors'.
 */
export const resolveAssetAttributes = (
  observations: ReadonlyArray<AssetObservation>,
  manualValues: ReadonlyArray<AssetManualValue> = [],
  criticalityLift: AssetCriticality | null = null,
): ResolvedAssetAttributes => {
  // A manual observation exists to seed a family's property block, not to override a scalar: the
  // scalar attributes below stay governed by `manualValues` alone, so it is excluded before the
  // "at least one observation" guard runs.
  const connectorObservations = observations.filter((o) => o.origin !== 'user');
  if (connectorObservations.length === 0) {
    throw newError('resolveAssetAttributes requires at least one observation');
  }

  const manualName = manualValueOf<string>(manualValues, 'name');
  const manualExposure = manualValueOf<SupportingAssetExposure>(manualValues, 'exposure');
  const manualCategory = manualValueOf<AssetCategory>(manualValues, 'category');
  const manualCriticality = manualValueOf<AssetCriticality>(manualValues, 'criticality');
  const manualDescription = manualValueOf<string>(manualValues, 'description');
  const manualSubcategory = manualValueOf<AssetSubcategory>(manualValues, 'subcategory');
  const manualUrl = manualValueOf<string>(manualValues, 'url');
  const manualLinkedPerson = manualValueOf<string>(manualValues, 'linkedPerson');
  const winner = resolveWinner(connectorObservations);
  const categoryId = manualCategory ?? winner.reportedCategoryId;

  return {
    name: manualName ?? mostRecentlyActiveValue(connectorObservations, (o) => o.reportedName),
    exposure: manualExposure ?? mostSevere(connectorObservations.map((o) => o.reportedExposure), EXPOSURE_SEVERITY),
    categoryId,
    subcategoryId: subcategoryWithin(manualSubcategory ?? winner.reportedSubcategoryId, categoryId),
    criticality: manualCriticality ?? mostSevere([...connectorObservations.map((o) => o.reportedCriticality), criticalityLift ?? 'unknown'], ASSET_CRITICALITY_SEVERITY),
    description: manualDescription ?? mostRecentlyActiveValue(connectorObservations, (o) => o.reportedDescription),
    externalReference: mostRecentlyActiveValue(connectorObservations, (o) => o.externalReference),
    url: manualUrl ?? mostRecentlyActiveValue(connectorObservations, (o) => o.reportedUrl),
    linkedPerson: manualLinkedPerson ?? mostRecentlyActiveValue(connectorObservations, (o) => o.reportedLinkedPerson),
    firstSeenAt: earliest(connectorObservations.map((o) => o.firstSeenAt)),
    lastSeenAt: latest(connectorObservations.map((o) => o.lastSeenAt)),
  };
};
