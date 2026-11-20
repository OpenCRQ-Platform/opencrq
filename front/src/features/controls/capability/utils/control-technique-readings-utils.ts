import type { ControlTechniqueTestReading, TechniqueTestOutcome, UncoveredTechniqueTestReading } from '../types/validation';
import type { CapabilityEdge } from '../types/capability';
import type { EfficacyVerdict } from './engine-efficacy-utils';
import { efficacyVerdict } from './engine-efficacy-utils';

/** The three verdicts partition the techniques the engine reads; `uncovered` holds the tested ones it does not. */
export const EFFICACY_SEGMENTS = ['all', 'confirmed', 'lowered', 'untested', 'uncovered'] as const;
export type EfficacySegment = typeof EFFICACY_SEGMENTS[number];

export const isEfficacySegment = (key: string): key is EfficacySegment =>
  EFFICACY_SEGMENTS.some((segment) => segment === key);

export const readingsByTechnique = (
  readings: ReadonlyArray<ControlTechniqueTestReading> | undefined,
): Map<string, ControlTechniqueTestReading> => new Map((readings ?? []).map((reading) => [reading.mitreTechniqueId, reading]));

export const hasTestedReading = (readings: ReadonlyArray<ControlTechniqueTestReading> | undefined): boolean =>
  readings?.some((reading) => reading.tested !== null) ?? false;

/** A covered technique the query has not answered for yet reads as untested, the efficacy it would show being the declaration. */
export const verdictOfTechnique = (reading: ControlTechniqueTestReading | undefined): EfficacyVerdict =>
  (reading === undefined || !reading.covered ? 'untested' : efficacyVerdict(reading));

/** The covered techniques under each verdict, every one of them under exactly one. */
export const techniquesByVerdict = (
  techniqueIds: ReadonlyArray<string>,
  readings: ReadonlyMap<string, ControlTechniqueTestReading>,
): Record<EfficacyVerdict, Set<string>> => {
  const byVerdict: Record<EfficacyVerdict, Set<string>> = { confirmed: new Set(), lowered: new Set(), untested: new Set() };
  for (const techniqueId of techniqueIds) {
    byVerdict[verdictOfTechnique(readings.get(techniqueId))].add(techniqueId);
  }
  return byVerdict;
};

export type TestedUncoveredReading = ControlTechniqueTestReading & UncoveredTechniqueTestReading & { tested: TechniqueTestOutcome };

/** The techniques OpenAEV tested the control on that the engine does not read for it, a removed one included. */
export const testedUncoveredReadings = (readings: ReadonlyMap<string, ControlTechniqueTestReading>): Array<TestedUncoveredReading> =>
  [...readings.values()].filter((reading): reading is TestedUncoveredReading => !reading.covered && reading.tested !== null);

/** The readings on techniques the control has no edge on, by technique id. */
export const readingsWithoutEdge = (
  readings: ReadonlyMap<string, ControlTechniqueTestReading>,
  edgeTechniqueIds: ReadonlyArray<string>,
): Array<ControlTechniqueTestReading> => {
  const withEdge = new Set(edgeTechniqueIds);
  return [...readings.values()]
    .filter((reading) => !withEdge.has(reading.mitreTechniqueId))
    .sort((first, second) => first.techniqueExternalId.localeCompare(second.techniqueExternalId));
};

/**
 * The techniques the verdicts partition: the covered ones the engine reads, or whose reading has not
 * come yet, and the ones it reads with no edge, a phishing stage's parent reached through a sub-technique.
 */
export const pricedTechniqueIds = (
  coveredTechniqueIds: ReadonlyArray<string>,
  readings: ReadonlyMap<string, ControlTechniqueTestReading>,
): Array<string> => [...new Set([
  ...coveredTechniqueIds.filter((techniqueId) => readings.get(techniqueId)?.covered !== false),
  ...[...readings.values()].filter((reading) => reading.covered).map((reading) => reading.mitreTechniqueId),
])];

/**
 * The techniques each filter keeps. The three verdicts partition the techniques the engine reads; a
 * removed or unread one stays under `all` alone, and under `uncovered` once OpenAEV tested it.
 */
export const techniquesBySegment = (
  coveredTechniqueIds: ReadonlyArray<string>,
  readings: ReadonlyMap<string, ControlTechniqueTestReading>,
): Record<Exclude<EfficacySegment, 'all'>, Set<string>> => ({
  ...techniquesByVerdict(pricedTechniqueIds(coveredTechniqueIds, readings), readings),
  uncovered: new Set(testedUncoveredReadings(readings).map((reading) => reading.mitreTechniqueId)),
});

/** Whether an active edge ties the technique to the control: none, or a removed one, leaves it unlinked. */
export const isLinkedTechnique = (edges: ReadonlyArray<CapabilityEdge>, techniqueId: string): boolean =>
  edges.some((edge) => edge.techniqueId === techniqueId && edge.state !== 'removed');

/** Whether the tenant unlinked the technique from the control, which the server restores but refuses to add again. */
export const isRemovedTechnique = (edges: ReadonlyArray<CapabilityEdge>, techniqueId: string): boolean =>
  edges.some((edge) => edge.techniqueId === techniqueId && edge.state === 'removed');
