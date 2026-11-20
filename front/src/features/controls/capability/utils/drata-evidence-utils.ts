import { includesFolded } from '@app/utils/text-fold';

export interface DrataEvidenceControl {
  code: string,
  name: string,
  isReady: boolean,
}

export interface DrataEvidenceFilters {
  search: string,
  notReadyOnly: boolean,
}

export const filterDrataEvidence = <T extends DrataEvidenceControl>(controls: ReadonlyArray<T>, filters: DrataEvidenceFilters): Array<T> =>
  controls.filter((control) => (!filters.notReadyOnly || !control.isReady)
      && (includesFolded(control.code, filters.search) || includesFolded(control.name, filters.search)));

export const readyCountOf = (controls: ReadonlyArray<DrataEvidenceControl>): number =>
  controls.filter((control) => control.isReady).length;
