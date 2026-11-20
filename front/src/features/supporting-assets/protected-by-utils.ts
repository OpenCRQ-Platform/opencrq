import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '@app/module/client';
import type { CoverageBucket, StrengthRung } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { computeSoloEffectiveness } from '../controls/capability/utils/capability-effectiveness';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
export type ProtectingControl = RouterOutputs['supportingAssets']['getProtectingControls']['controls'][number];
export type ProtectingTechnique = ProtectingControl['standsOn'][number];
type TestScope = ProtectingTechnique['here'];

export type ProtectingControlRow = ProtectingControl & { id: string };

/** Three cells: the four rungs and the four buckets map onto none to all filled. */
export const strengthCellsFilled = (rung: StrengthRung): number => STRENGTH_RUNGS.indexOf(rung);

export const coverageCellsFilled = (bucket: CoverageBucket): number => COVERAGE_BUCKETS.indexOf(bucket);

/** A control nobody assessed has no effectiveness to rank on. */
const byProtection = (score: (control: ProtectingControl) => number) => (a: ProtectingControl, b: ProtectingControl): number => {
  if (a.assessed !== b.assessed) {
    return a.assessed ? -1 : 1;
  }
  return (a.assessed ? score(b) - score(a) : 0)
    || b.assetTechniqueCount - a.assetTechniqueCount
    || a.externalId.localeCompare(b.externalId);
};

export const splitProtectingControls = (
  controls: ReadonlyArray<ProtectingControl>,
): {
  protecting: Array<ProtectingControlRow>,
  testedOutside: Array<ProtectingControlRow>,
} => {
  const score = (control: ProtectingControl): number => computeSoloEffectiveness(control).score;
  const rows = controls.map((control) => ({ ...control, id: control.capabilityId })).toSorted(byProtection(score));
  return {
    protecting: rows.filter((row) => row.protectsAssetCategory),
    testedOutside: rows.filter((row) => !row.protectsAssetCategory),
  };
};

export type Tally = NonNullable<TestScope['prevention']>;
export type Verdicts = Pick<TestScope, 'prevention' | 'detection'>;

export const isTestedScope = (scope: Verdicts): boolean => scope.prevention !== null || scope.detection !== null;

export const tallyLetThrough = (tally: Tally): boolean => tally.held < tally.total;

export const hasLetThrough = (scope: Verdicts): boolean =>
  [scope.prevention, scope.detection].some((tally) => tally !== null && tallyLetThrough(tally));

export const testedTechniqueIds = (control: ProtectingControl): Array<string> =>
  control.standsOn.filter((technique) => isTestedScope(technique.here)).map((technique) => technique.externalId);

const sumTallies = (tallies: ReadonlyArray<Tally | null>): Tally | null => {
  const present = tallies.filter((tally): tally is Tally => tally !== null);
  return present.length === 0
    ? null
    : present.reduce((sum, tally) => ({ held: sum.held + tally.held, total: sum.total + tally.total }));
};

export const fleetTotal = (control: ProtectingControl): { verdicts: Verdicts, techniqueCount: number } => {
  const tested = control.standsOn.filter((technique) => isTestedScope(technique.fleet));
  return {
    verdicts: {
      prevention: sumTallies(tested.map((technique) => technique.fleet.prevention)),
      detection: sumTallies(tested.map((technique) => technique.fleet.detection)),
    },
    techniqueCount: tested.length,
  };
};

export const splitByTesting = (control: ProtectingControl): {
  tested: Array<ProtectingTechnique>,
  neverTested: Array<ProtectingTechnique>,
} => {
  const wasTested = (technique: ProtectingTechnique): boolean => isTestedScope(technique.here) || isTestedScope(technique.fleet);
  return {
    tested: control.standsOn.filter(wasTested),
    neverTested: control.standsOn.filter((technique) => !wasTested(technique)),
  };
};
