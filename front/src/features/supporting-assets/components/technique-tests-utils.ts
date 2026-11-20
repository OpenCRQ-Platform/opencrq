import type { ExpectationType, PostureBand, SeverityBand } from '@app/module/client';
import { postureBandForScore, postureSeverityBand } from '@app/module/client';

export interface TestTally {
  held: number,
  total: number,
}

export interface TechniqueTests {
  prevention: TestTally | null,
  detection: TestTally | null,
}

/** Higher is better, as on OpenAEV's own posture. */
export const heldShare = ({ held, total }: TestTally): number => Math.round((100 * held) / total);

export const heldPostureBand = (tally: TestTally): PostureBand => postureBandForScore(heldShare(tally));

export const heldSeverityBand = (tally: TestTally): SeverityBand => postureSeverityBand(heldPostureBand(tally));

export const hasTestReading = (tests: TechniqueTests | undefined): tests is TechniqueTests =>
  tests !== undefined && (tests.prevention !== null || tests.detection !== null);

export const testedTechniqueCount = (
  techniqueIds: ReadonlyArray<string>,
  tests: ReadonlyMap<string, TechniqueTests>,
  type: ExpectationType,
): number => techniqueIds.filter((id) => (tests.get(id)?.[type] ?? null) !== null).length;
