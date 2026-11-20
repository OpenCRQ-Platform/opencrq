import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type { PostureSource } from '../controls/capability/scope-posture';
import type { MeasuredValidityPolicy } from '../finding-score/engine';
import type { TechniqueTestRecord, TechniqueTestScope, TestTally } from '../finding-score/service';
import type { AssetCategory, ExpectationType } from '../supporting-assets/constants';
import type { PlatformFamilyControl, ValidationEvidenceRow } from './engine';
import { CAPABILITY_FUNCTIONS } from '../controls/capability/constants';
import { DEFAULT_COVERAGE_BUCKET, DEFAULT_STRENGTH_RUNG } from '../controls/capability/scope-posture';
import { isFreshMeasurement, resolveMeasuredResult } from '../finding-score/engine';
import { UNCLASSIFIED_ASSET_CATEGORY } from '../supporting-assets/constants';
import { EXPECTATION_TYPE_TO_FUNCTION } from './constants';
import { indexPlatformControls, indexScoredEdges, resolveCellTechniqueId } from './engine';

export interface ProtectionTechnique {
  id: string,
  externalId: string,
  name: string | null,
  parentTechniqueId: string | null,
}

export interface ProtectionPosture {
  capabilityId: string,
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  strengthSource: PostureSource,
  coverageSource: PostureSource,
  tenantStrengthRung: StrengthRung | null,
  tenantCoverageBucket: CoverageBucket | null,
}

export interface AssetProtectionInput {
  categoryId: AssetCategory,
  /** The techniques of the asset's category plus those of its applicable findings. */
  assetTechniqueIds: ReadonlyArray<string>,
  /** Every technique an asset technique or a row names, with its parent. */
  techniques: ReadonlyMap<string, ProtectionTechnique>,
  edges: ReadonlyArray<EffectiveEdge>,
  protectedFamilies: ReadonlyArray<{ capabilityId: string, categoryId: string }>,
  platformControls: ReadonlyArray<PlatformFamilyControl>,
  /** Resolved on the risk scope being read; a control absent here was never declared anywhere. */
  postures: ReadonlyArray<ProtectionPosture>,
  capabilities: ReadonlyArray<{ id: string, externalId: string, name: string }>,
  /** This asset's results. */
  rows: ReadonlyArray<ValidationEvidenceRow>,
  /** The fresh results of the scope's estate on the techniques above, this asset's included. */
  fleet: FleetFolds,
}

export interface FleetPair {
  platformTypeKey: string,
  expectationType: ExpectationType,
}

/** The fresh results of one family and expectation type on one technique. */
export interface FleetTally extends FleetPair {
  techniqueId: string,
  held: number,
  total: number,
  lastRunAt: Date | null,
}

/** How many assets were tested on one technique by exactly these families and expectation types. */
export interface FleetCoverage {
  techniqueId: string,
  pairs: Array<FleetPair>,
  assetCount: number,
}

/**
 * The fleet folded at the two grains that keep what every control reads of it: tallies add up across
 * pairs, and an asset counts once for a control whichever of its pairs the control counts.
 */
export interface FleetFolds {
  tallies: ReadonlyArray<FleetTally>,
  coverage: ReadonlyArray<FleetCoverage>,
}

/** `onAsset` false: a technique outside the asset's own, listed because the control was tested on it here. */
export interface ProtectingTechnique extends TechniqueTestRecord {
  onAsset: boolean,
}

export interface ProtectingControl extends ProtectionPosture {
  externalId: string,
  name: string,
  /** Neither the tenant nor the scope declared it; the posture fields then hold the undeclared default. */
  assessed: boolean,
  /** Always true on an unclassified asset, which no family gate applies to. */
  protectsAssetCategory: boolean,
  /** A security platform family implements it, so a result can speak for it. */
  testable: boolean,
  /** How many of the asset's own techniques it stands on. */
  assetTechniqueCount: number,
  /** Null when no fresh result on this asset speaks for it. */
  testedHere: TechniqueTestScope | null,
  standsOn: Array<ProtectingTechnique>,
}

const emptyReading = (): TechniqueTestScope => ({ prevention: null, detection: null, lastRunAt: null });

const recordRuns = (
  reading: TechniqueTestScope,
  { expectationType, held, total, lastRunAt }: { expectationType: ExpectationType, held: number, total: number, lastRunAt: Date | null },
): void => {
  const side = expectationType === 'prevention' ? 'prevention' : 'detection';
  const tally = reading[side] ?? { held: 0, total: 0 };
  reading[side] = { held: tally.held + held, total: tally.total + total };
  if (lastRunAt !== null && (reading.lastRunAt === null || lastRunAt.getTime() > reading.lastRunAt.getTime())) {
    reading.lastRunAt = lastRunAt;
  }
};

const groupByTechnique = <T extends { techniqueId: string }>(entries: ReadonlyArray<T>): Map<string, Array<T>> => {
  const grouped = new Map<string, Array<T>>();
  for (const entry of entries) {
    grouped.set(entry.techniqueId, [...grouped.get(entry.techniqueId) ?? [], entry]);
  }
  return grouped;
};

const sumTallies = (tallies: ReadonlyArray<TestTally | null>): TestTally | null => {
  const present = tallies.filter((tally): tally is TestTally => tally !== null);
  return present.length === 0 ? null : {
    held: present.reduce((sum, tally) => sum + tally.held, 0),
    total: present.reduce((sum, tally) => sum + tally.total, 0),
  };
};

const isTested = (scope: TechniqueTestScope): boolean => scope.prevention !== null || scope.detection !== null;

/** What was tested here first, then what was tested elsewhere, so a reader meets the evidence before the silence. */
const readingRank = (technique: ProtectingTechnique): number => {
  if (isTested(technique.here)) {
    return 0;
  }
  return isTested(technique.fleet) ? 1 : 2;
};

const byReadingThenId = (a: ProtectingTechnique, b: ProtectingTechnique): number =>
  readingRank(a) - readingRank(b) || a.externalId.localeCompare(b.externalId);

/**
 * No control is linked to an asset, so the list is derived the way the finding's controls are: a
 * control protecting the asset's category that stands, through the tenant's effective coverage and
 * the parent fallback, on one of the asset's techniques. A control protecting another category is
 * kept only when a fresh result on this asset speaks for it, since a measurement is a fact about the
 * asset whatever the category table says.
 *
 * Every reading counts only what the validation engine attributes to the control: a fresh
 * connector verdict, from a platform family implementing it, on a technique it covers for the
 * expectation's function, so the tally a row shows is always the sum of the readings its drawer lists.
 */
export const deriveAssetProtection = (
  input: AssetProtectionInput,
  context: { policy: MeasuredValidityPolicy, now: Date },
): Array<ProtectingControl> => {
  const scoredEdges = indexScoredEdges(input.edges);
  const capabilitiesByPlatformType = indexPlatformControls(input.platformControls);
  const testableIds = new Set(input.platformControls.map((pair) => pair.capabilityId));
  const assetTechniqueIds = new Set(input.assetTechniqueIds);

  const techniqueRow = (techniqueId: string) =>
    ({ mitreTechniqueId: techniqueId, parentTechniqueId: input.techniques.get(techniqueId)?.parentTechniqueId ?? null });
  const coversOn = (capabilityId: string, techniqueId: string): boolean =>
    CAPABILITY_FUNCTIONS.some((fn) => resolveCellTechniqueId(scoredEdges, capabilityId, techniqueRow(techniqueId), fn) !== null);

  const tallies = groupByTechnique(input.fleet.tallies);
  const coverage = groupByTechnique(input.fleet.coverage);
  /** The rule the loop below applies to this asset's rows, on the fleet's folds. */
  const fleetOf = (capabilityId: string, techniqueId: string): TechniqueTestScope & { assetCount: number } => {
    const counts = (pair: FleetPair): boolean =>
      (capabilitiesByPlatformType.get(pair.platformTypeKey) ?? []).includes(capabilityId)
      && resolveCellTechniqueId(scoredEdges, capabilityId, techniqueRow(techniqueId), EXPECTATION_TYPE_TO_FUNCTION[pair.expectationType]) !== null;
    const reading = emptyReading();
    for (const tally of (tallies.get(techniqueId) ?? []).filter(counts)) {
      recordRuns(reading, tally);
    }
    const assetCount = (coverage.get(techniqueId) ?? [])
      .filter((group) => group.pairs.some(counts))
      .reduce((sum, group) => sum + group.assetCount, 0);
    return { ...reading, assetCount };
  };

  // One reading per (control, technique), the technique being the row's own rather than the cell it
  // lands in: a sub-technique result stays under the sub-technique, so nothing counts twice.
  const readings = new Map<string, TechniqueTestScope>();
  const readingOf = (capabilityId: string, techniqueId: string): TechniqueTestScope => {
    const key = `${capabilityId}:${techniqueId}`;
    const reading = readings.get(key) ?? emptyReading();
    readings.set(key, reading);
    return reading;
  };
  const testedHereTechniques = new Map<string, Set<string>>();

  for (const row of input.rows) {
    const measured = resolveMeasuredResult(row);
    if (measured === null || !isFreshMeasurement(measured, context.policy, context.now) || row.securityPlatformType === null) {
      continue;
    }
    const fn = EXPECTATION_TYPE_TO_FUNCTION[row.expectationType];
    const held = measured.verdict === 'held';
    for (const capabilityId of capabilitiesByPlatformType.get(row.securityPlatformType) ?? []) {
      if (resolveCellTechniqueId(scoredEdges, capabilityId, row, fn) === null) {
        continue;
      }
      recordRuns(readingOf(capabilityId, row.mitreTechniqueId), {
        expectationType: row.expectationType,
        held: held ? 1 : 0,
        total: 1,
        lastRunAt: measured.measuredAt,
      });
      const tested = testedHereTechniques.get(capabilityId) ?? new Set<string>();
      tested.add(row.mitreTechniqueId);
      testedHereTechniques.set(capabilityId, tested);
    }
  }

  const postureByCapability = new Map(input.postures.map((posture) => [posture.capabilityId, posture]));
  const protectingIds = new Set(input.protectedFamilies
    .filter((pair) => pair.categoryId === input.categoryId)
    .map((pair) => pair.capabilityId));
  const standingIds = new Set(input.edges.map((edge) => edge.capabilityId));

  return input.capabilities.flatMap((capability): Array<ProtectingControl> => {
    if (!standingIds.has(capability.id) && !testedHereTechniques.has(capability.id)) {
      return [];
    }
    const protectsAssetCategory = input.categoryId === UNCLASSIFIED_ASSET_CATEGORY || protectingIds.has(capability.id);
    const assetTechniques = input.assetTechniqueIds.filter((techniqueId) => coversOn(capability.id, techniqueId));
    const offAsset = [...testedHereTechniques.get(capability.id) ?? []].filter((techniqueId) => !assetTechniqueIds.has(techniqueId));
    const standsOn = [...assetTechniques, ...offAsset].map((techniqueId): ProtectingTechnique => {
      const technique = input.techniques.get(techniqueId);
      return {
        mitreTechniqueId: techniqueId,
        externalId: technique?.externalId ?? techniqueId,
        name: technique?.name ?? null,
        onAsset: assetTechniqueIds.has(techniqueId),
        here: readingOf(capability.id, techniqueId),
        fleet: fleetOf(capability.id, techniqueId),
      };
    }).sort(byReadingThenId);

    const tested = standsOn.filter((technique) => isTested(technique.here));
    const listed = protectsAssetCategory ? assetTechniques.length > 0 : tested.length > 0;
    if (!listed) {
      return [];
    }

    const posture = postureByCapability.get(capability.id);
    const lastRuns = tested.flatMap((technique) => (technique.here.lastRunAt === null ? [] : [technique.here.lastRunAt.getTime()]));
    return [{
      capabilityId: capability.id,
      externalId: capability.externalId,
      name: capability.name,
      strengthRung: posture?.strengthRung ?? DEFAULT_STRENGTH_RUNG,
      coverageBucket: posture?.coverageBucket ?? DEFAULT_COVERAGE_BUCKET,
      strengthSource: posture?.strengthSource ?? 'tenant',
      coverageSource: posture?.coverageSource ?? 'tenant',
      tenantStrengthRung: posture?.tenantStrengthRung ?? null,
      tenantCoverageBucket: posture?.tenantCoverageBucket ?? null,
      assessed: posture !== undefined && (posture.tenantStrengthRung !== null
        || posture.tenantCoverageBucket !== null
        || posture.strengthSource === 'scope'
        || posture.coverageSource === 'scope'),
      protectsAssetCategory,
      testable: testableIds.has(capability.id),
      assetTechniqueCount: assetTechniques.length,
      testedHere: tested.length === 0 ? null : {
        prevention: sumTallies(tested.map((technique) => technique.here.prevention)),
        detection: sumTallies(tested.map((technique) => technique.here.detection)),
        lastRunAt: lastRuns.length === 0 ? null : new Date(Math.max(...lastRuns)),
      },
      standsOn,
    }];
  }).sort((a, b) => a.externalId.localeCompare(b.externalId));
};
