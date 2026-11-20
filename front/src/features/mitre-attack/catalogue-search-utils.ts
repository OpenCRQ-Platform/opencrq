import { includesFolded } from '@app/utils/text-fold';

interface CatalogueEntry {
  externalId: string,
  name: string,
}

/**
 * The description is left out: common words ("process", "file") appear in most technique
 * descriptions, so matching it would keep nearly the whole catalogue.
 */
export const searchCatalogue = <T extends CatalogueEntry>(entries: ReadonlyArray<T>, search: string): Array<T> =>
  entries.filter((entry) => includesFolded(entry.externalId, search)
      || includesFolded(entry.name, search));
