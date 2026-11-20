import type { CapabilityFunction } from '@app/module/client';
import type { TechniqueCapability } from '../types/capability';
import type { TechniqueControlTestReading } from '../types/validation';
import { computeSoloEffectiveness } from './capability-effectiveness';

const deploymentScore = (control: TechniqueCapability): number =>
  (control.assessment === null ? 0 : computeSoloEffectiveness(control.assessment).score);

/**
 * The controls covering a technique on one function, most deployed first, with the ones the tenant
 * removed last: the reader is asking what actually stands in the way, and a removed control answers
 * nothing while still being worth seeing.
 */
export const controlsForFunction = (
  controls: ReadonlyArray<TechniqueCapability>,
  capabilityFunction: CapabilityFunction,
): Array<TechniqueCapability> => controls
  .filter((control) => control.function === capabilityFunction)
  // The score is read once per control rather than on every comparison, which would recompute it
  // O(n log n) times.
  .map((control) => ({ control, score: deploymentScore(control) }))
  .sort((a, b) => {
    if ((a.control.state === 'removed') !== (b.control.state === 'removed')) {
      return a.control.state === 'removed' ? 1 : -1;
    }
    return b.score - a.score || a.control.externalId.localeCompare(b.control.externalId);
  })
  .map(({ control }) => control);

/**
 * The engine's reading of each control on its function: a covered one priced, an uncovered one, a
 * control the tenant removed from the technique included, with its result alone.
 */
export const readingOf = (
  readings: ReadonlyArray<TechniqueControlTestReading> | undefined,
  control: Pick<TechniqueCapability, 'id' | 'function'>,
): TechniqueControlTestReading | undefined =>
  readings?.find((reading) => reading.capabilityId === control.id && reading.function === control.function);

/**
 * A control listed on a technique: `edge` for one the catalogue or the tenant puts there, `tested` for
 * one with OpenAEV results there and no edge on it, which the engine counts only through a phishing
 * stage the control reaches by a sub-technique.
 */
export type TechniqueControlRow =
  | TechniqueCapability & { kind: 'edge' }
  | Pick<TechniqueCapability, 'id' | 'externalId' | 'name' | 'function'> & {
    kind: 'tested',
    /** The rungs the control is declared at on the level, which the engine reads nowhere on this technique. */
    rungs: TechniqueControlTestReading['capabilityRungs'],
  };

/** The strength and coverage a row's columns show, none where the control is not assessed. */
export const rungsOf = (row: TechniqueControlRow): Pick<NonNullable<TechniqueCapability['assessment']>, 'strengthRung' | 'coverageBucket'> | null =>
  (row.kind === 'edge' ? row.assessment : row.rungs);

/**
 * Where a row stands: the controls the engine reads on the technique first, then the ones it does not
 * though they have an edge there, the removed ones, and last the ones only tested there.
 */
const rowRank = (row: TechniqueControlRow, reading: TechniqueControlTestReading | undefined): number => {
  if (reading?.covered === true) {
    return 0;
  }
  if (row.kind === 'tested') {
    return 3;
  }
  if (row.state === 'removed') {
    return 2;
  }
  return reading === undefined ? 0 : 1;
};

/**
 * The card's count: `covering`, the rows `rowRank` puts first, the ones the engine reads or, before
 * its readings arrive, the edges that still count; `notCovered`, the others.
 */
export const controlCounts = (
  rows: ReadonlyArray<TechniqueControlRow>,
  readings: ReadonlyArray<TechniqueControlTestReading> | undefined,
): { covering: number, notCovered: number } => {
  const covering = rows.filter((row) => rowRank(row, readingOf(readings, row)) === 0).length;
  return { covering, notCovered: rows.length - covering };
};

/**
 * The controls of the function listed on the technique: the ones with an edge there in
 * `controlsForFunction`'s order, then the ones only tested there by catalogue id, each kept within the
 * rank `rowRank` gives it.
 */
export const controlRowsForFunction = (
  controls: ReadonlyArray<TechniqueCapability>,
  readings: ReadonlyArray<TechniqueControlTestReading> | undefined,
  capabilityFunction: CapabilityFunction,
): Array<TechniqueControlRow> => {
  const edgeRows = controlsForFunction(controls, capabilityFunction);
  const listed = new Set(edgeRows.map((control) => control.id));
  const testedRows = (readings ?? [])
    .filter((reading) => reading.function === capabilityFunction && !listed.has(reading.capabilityId))
    .map((reading): TechniqueControlRow => ({
      kind: 'tested',
      id: reading.capabilityId,
      externalId: reading.capabilityExternalId,
      name: reading.capabilityName,
      function: reading.function,
      rungs: reading.capabilityRungs,
    }))
    .sort((first, second) => first.externalId.localeCompare(second.externalId));
  return [...edgeRows.map((control): TechniqueControlRow => ({ ...control, kind: 'edge' })), ...testedRows]
    .map((row, position) => ({ row, position, rank: rowRank(row, readingOf(readings, row)) }))
    .sort((first, second) => first.rank - second.rank || first.position - second.position)
    .map(({ row }) => row);
};
