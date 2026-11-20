import { includesFolded } from '@app/utils/text-fold';

interface CatalogueEntry {
  externalId: string,
  name: string,
  modified: boolean,
  presentInFindings: boolean,
}

export interface CweCatalogueFilters {
  search: string,
  presentInFindings: boolean,
  modified: boolean,
}

const cweNumber = (externalId: string): number => Number(externalId.replace(/^CWE-/, ''));

/** Orders `CWE-79` before `CWE-120`, which a string comparison would not. */
export const compareCweIds = (left: string, right: string): number => cweNumber(left) - cweNumber(right);

export const filterCweCatalogue = <T extends CatalogueEntry>(
  entries: ReadonlyArray<T>,
  filters: CweCatalogueFilters,
): Array<T> =>
  entries.filter((entry) => (!filters.presentInFindings || entry.presentInFindings)
      && (!filters.modified || entry.modified)
      && (includesFolded(entry.externalId, filters.search)
        || includesFolded(entry.name, filters.search)));
