import { includesFolded } from '@app/utils/text-fold';

export const filterPrimaryAssets = <T extends { name: string, description: string | null, reference: string | null }>(rows: ReadonlyArray<T>, search: string): Array<T> =>
  rows.filter((row) => includesFolded(row.name, search) || includesFolded(row.description, search) || includesFolded(row.reference, search));
