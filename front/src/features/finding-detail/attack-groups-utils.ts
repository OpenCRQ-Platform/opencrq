import type { AssetCategory, AttackGroup, SupportingAssetExposure } from '@app/module/client';
import type { FindingScoreBreakdown } from '../finding-score';

export type AttackClaimRow = NonNullable<FindingScoreBreakdown['columns']['techniques']>['rows'][number];

export interface TechniqueCoverage {
  assetCount: number,
  setAside: Array<{ categoryId: AssetCategory, assetCount: number }>,
  /** The exposures of the assets the row was read on, which only a topology row narrows. */
  exposures: Array<SupportingAssetExposure>,
}

export interface AttackCoverage {
  cveId: string,
  totalAssetCount: number,
  byRow: Map<string, TechniqueCoverage>,
}

export const attackRowKey = (row: { mitreTechniqueId: string, group: AttackGroup }): string => `${row.mitreTechniqueId}-${row.group}`;

export const holdsOnEveryAsset = (coverage: TechniqueCoverage, totalAssetCount: number): boolean => coverage.assetCount >= totalAssetCount;

export const coverageMarker = (coverage: TechniqueCoverage | undefined, totalAssetCount: number): string | undefined =>
  (coverage === undefined || holdsOnEveryAsset(coverage, totalAssetCount) ? undefined : `${coverage.assetCount}/${totalAssetCount}`);

export type ExposureReading = 'all' | 'internetFacing' | 'internal' | 'unknown' | 'internetFacingAndUnknown' | 'internalAndUnknown' | 'internetFacingAndInternal';

export const exposureReadingOf = (exposures: ReadonlyArray<SupportingAssetExposure>): ExposureReading => {
  const internetFacing = exposures.includes('internet_facing');
  const internal = exposures.includes('internal');
  const unknown = exposures.includes('unknown');
  if (internetFacing && internal) {
    return unknown ? 'all' : 'internetFacingAndInternal';
  }
  if (unknown) {
    if (internetFacing) {
      return 'internetFacingAndUnknown';
    }
    return internal ? 'internalAndUnknown' : 'unknown';
  }
  return internetFacing ? 'internetFacing' : 'internal';
};

export const ATTACK_GROUPS: ReadonlyArray<AttackGroup> = ['exploitation', 'primary_impact', 'secondary_impact', 'weakness'];

/** Dark to light, since the three roles follow each other, and a neutral for the roleless weakness group. */
export const ATTACK_GROUP_ACCENT: Readonly<Record<AttackGroup, string>> = {
  exploitation: 'var(--fds-red-600)',
  primary_impact: 'var(--fds-red-400)',
  secondary_impact: 'var(--fds-red-300)',
  weakness: 'var(--fds-gray-500)',
};

export interface AttackGroupRows {
  group: AttackGroup,
  rows: Array<AttackClaimRow>,
  setAside: Array<AttackClaimRow>,
}

/**
 * Only a way in can be set aside. An impact, and whatever the weakness makes possible, says what
 * follows the breach, wherever it follows.
 */
const isWayIn = (group: AttackGroup): boolean => group === 'exploitation';

export const groupAttackRows = (rows: ReadonlyArray<AttackClaimRow>): Array<AttackGroupRows> =>
  ATTACK_GROUPS.map((group) => {
    const inGroup = rows.filter((row) => row.group === group);
    return {
      group,
      rows: inGroup.filter((row) => !isWayIn(group) || row.carriedByAssetFamily),
      setAside: inGroup.filter((row) => isWayIn(group) && !row.carriedByAssetFamily),
    };
  });

export interface MatrixTechnique {
  mitreTechniqueId: string,
  /** The row the cell stands for, in the group that gives it its accent. */
  row: AttackClaimRow,
  /** The first group the technique stands in, in attack order: it gives the cell its accent. */
  group: AttackGroup,
  groups: Array<AttackGroup>,
  setAside: boolean,
}

/** One cell per technique, since a technique can stand in several groups and a cell has one accent. */
export const matrixTechniques = (grouped: ReadonlyArray<AttackGroupRows>): Array<MatrixTechnique> => {
  const byTechnique = new Map<string, { rows: Array<AttackClaimRow>, groups: Array<AttackGroup>, setAsideGroups: Array<AttackGroup> }>();
  for (const { group, rows, setAside } of grouped) {
    for (const row of [...rows, ...setAside]) {
      const entry = byTechnique.get(row.mitreTechniqueId) ?? { rows: [], groups: [], setAsideGroups: [] };
      entry.rows.push(row);
      entry.groups.push(group);
      if (setAside.includes(row)) {
        entry.setAsideGroups.push(group);
      }
      byTechnique.set(row.mitreTechniqueId, entry);
    }
  }
  return [...byTechnique].map(([mitreTechniqueId, { rows, groups, setAsideGroups }]) => {
    const shown = groups.filter((group) => !setAsideGroups.includes(group));
    const group = shown[0] ?? groups[0];
    return {
      mitreTechniqueId,
      row: rows[groups.indexOf(group)],
      group,
      groups,
      setAside: shown.length === 0,
    };
  });
};

export const tacticNamesByTechnique = (matrix: {
  tactics: Array<{ id: string, name: string, order: number }>,
  techniques: Array<{ id: string, parentTechniqueId: string | null }>,
  junctions: Array<{ tacticId: string, techniqueId: string }>,
}): Map<string, Array<string>> => {
  const tacticById = new Map(matrix.tactics.map((tactic) => [tactic.id, tactic]));
  const own = new Map<string, Array<{ name: string, order: number }>>();
  for (const junction of matrix.junctions) {
    const tactic = tacticById.get(junction.tacticId);
    if (tactic !== undefined) {
      own.set(junction.techniqueId, [...(own.get(junction.techniqueId) ?? []), tactic]);
    }
  }
  const names = (tactics: Array<{ name: string, order: number }>): Array<string> =>
    [...tactics].sort((left, right) => left.order - right.order).map((tactic) => tactic.name);
  return new Map(matrix.techniques.map((technique) => [
    technique.id,
    names(own.get(technique.id) ?? (technique.parentTechniqueId === null ? [] : own.get(technique.parentTechniqueId) ?? [])),
  ]));
};
