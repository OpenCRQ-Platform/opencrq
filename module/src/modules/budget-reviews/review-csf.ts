import type { CsfFunction } from './constants';
import { CSF_FUNCTIONS } from './constants';

export interface CsfCrosswalkRow {
  capabilityId: string,
  /** A CSF 2.0 subcategory, `PR.AA-01`, whose prefix names its function. */
  externalId: string,
}

const isCsfFunction = (value: string): value is CsfFunction => (CSF_FUNCTIONS as ReadonlyArray<string>).includes(value);

const csfFunctionOf = (externalId: string): CsfFunction | null => {
  const prefix = externalId.split('.')[0];
  return isCsfFunction(prefix) ? prefix : null;
};

/**
 * Every function one of the line's controls maps to, in the wheel's order. A line takes them all, so
 * its spend counts towards each and is never split between them.
 */
export const lineCsfFunctions = (capabilityIds: ReadonlyArray<string>, crosswalk: ReadonlyArray<CsfCrosswalkRow>): Array<CsfFunction> => {
  const held = new Set(capabilityIds);
  const functions = new Set(crosswalk
    .filter((row) => held.has(row.capabilityId))
    .map((row) => csfFunctionOf(row.externalId)));
  return CSF_FUNCTIONS.filter((csfFunction) => functions.has(csfFunction));
};
