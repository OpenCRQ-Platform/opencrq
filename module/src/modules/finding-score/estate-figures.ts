import type { ExpectationType } from '../supporting-assets/constants';

export const AGED_FINDING_DAYS = 90;

export const TECHNIQUE_POSTURE_CHANGE_DAYS = 30;

const DAY_MS = 86_400_000;

export const daysBefore = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

export interface OpenFindingFigures {
  open: number,
  critical: number,
  internetExposed: number,
  knownExploited: number,
  aged: number,
}

export interface TechniqueTestTally {
  held: number,
  total: number,
}

export interface TechniqueTestPosture {
  testedAssetCount: number,
  expectations: Record<ExpectationType, { current: TechniqueTestTally | null, previous: TechniqueTestTally | null }>,
}

export const expectationTally = (
  rows: ReadonlyArray<{ expectationType: ExpectationType | null, held: number, total: number }>,
  expectationType: ExpectationType,
): TechniqueTestTally | null => {
  const row = rows.find((candidate) => candidate.expectationType === expectationType);
  return row === undefined || row.total === 0 ? null : { held: Number(row.held), total: Number(row.total) };
};
