import { includesFolded } from '@app/utils/text-fold';
import type { ListedCapability } from './types/capability';
import { isScopeDeclared } from './utils/scope-posture-utils';

// Flat catalogue of control capabilities: no parent/child hierarchy.

export type AssessmentFilter = 'all' | 'unassessed' | 'forced';

export interface CapabilitiesDataFilters {
  search: string,
  assessment: AssessmentFilter,
}

/** Only a scope can override the tenant, so a shared link carrying `forced` opens the whole list outside one. */
export const resolveAssessmentFilter = (filter: AssessmentFilter, inScope: boolean): AssessmentFilter =>
  (filter === 'forced' && !inScope ? 'all' : filter);

const isUnassessed = (capability: ListedCapability): boolean => capability.assessment === null;

const matchesAssessment = (capability: ListedCapability, filter: AssessmentFilter): boolean => {
  if (filter === 'unassessed') {
    return isUnassessed(capability);
  }
  if (filter === 'forced') {
    return isScopeDeclared(capability);
  }
  return true;
};

export const buildCapabilitiesView = (data: Array<ListedCapability> | undefined, filters: CapabilitiesDataFilters) => {
  const processedData = !data
    ? []
    : data.filter((item) => {
      if (!matchesAssessment(item, filters.assessment)) {
        return false;
      }
      return (
        includesFolded(item.name, filters.search) ||
        includesFolded(item.externalId, filters.search)
      );
    });

  return {
    processedData,
    unassessedCount: processedData.filter(isUnassessed).length,
  };
};
