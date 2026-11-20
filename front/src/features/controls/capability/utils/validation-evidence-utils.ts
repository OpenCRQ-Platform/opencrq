import type { CapabilityFunction } from '@app/module/client';
import type { CapabilityValidationEvidenceListSearch } from '../capability-validation-evidence-list-search';
import { resolveOptionFilter } from '../../../../utils';

export interface EvidenceTechnique {
  externalId: string,
  name: string,
}

export interface TechniqueFilterOption {
  value: string,
  label: string,
}

/**
 * The technique filter's options, by ATT&CK id and name. A technique the address names that is not
 * among them, which no line is filed on or whose options are still loading, is offered by its id
 * alone, so the filter in force stays visible and can be cleared.
 */
export const techniqueFilterOptions = (
  techniques: ReadonlyArray<EvidenceTechnique> | undefined,
  selected: string | undefined,
): Array<TechniqueFilterOption> => {
  const options = (techniques ?? []).map(({ externalId, name }) => ({ value: externalId, label: `${externalId} – ${name}` }));
  return selected === undefined || options.some((option) => option.value === selected)
    ? options
    : [{ value: selected, label: selected }, ...options];
};

export interface EvidenceLineFilters {
  technique?: string,
  function?: CapabilityFunction,
  result?: 'validated' | 'contradicted',
  securityPlatformType?: string,
}

/** The filters the server applies; a family the control does not have reads as every family. */
export const evidenceLineFilters = (
  search: CapabilityValidationEvidenceListSearch,
  familyKeys: Array<string>,
): EvidenceLineFilters => {
  const family = resolveOptionFilter(search.family ?? '', familyKeys, '');
  return {
    technique: search.technique,
    function: search.function === 'all' ? undefined : search.function,
    result: search.result === 'all' ? undefined : search.result,
    securityPlatformType: family === '' ? undefined : family,
  };
};

export const isFiltered = (filters: EvidenceLineFilters): boolean =>
  Object.values(filters).some((value) => value !== undefined);

/** The share of a line's assets that held, which a line always has one of. */
export const heldShare = ({ validated, contradicted }: { validated: number, contradicted: number }): number =>
  (validated + contradicted === 0 ? 0 : validated / (validated + contradicted));
