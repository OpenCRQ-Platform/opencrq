import type { AssetCategory, DismissalType, EvidenceHistoryOrigin, EvidenceState, ExpectationType, SeverityBand } from '@app/module/client';
import { daysSince } from '../../utils';

/**
 * What kind of thing the finding is. A CVE is a flaw in the estate; a technique finding is the
 * estate's answer when that technique was run against it, which is why it reads by expectation.
 */
export type FindingKind = 'vulnerability' | 'detection_response' | 'prevention_response' | 'control_response';

export interface FindingTableRow {
  id: string,
  name: string,
  detail: string | null,
  kind: FindingKind,
  currentState: EvidenceState,
  /** Of the latest history row, which words a dismissed state. */
  stateOrigin: EvidenceHistoryOrigin | null,
  dismissalType: DismissalType | null,
  /** Null on a CVE finding until its first scoring pass or while pending a vector, and always on a technique finding. */
  score: number | null,
  band: SeverityBand | null,
  pendingVector: boolean,
  /** An NVD pass read the CVE and found no usable record: the vector the finding waits on will not come from NVD. */
  nvdRecordMissing: boolean,
  assetName: string | null,
  assetDerivedName: string | null,
  assetCategoryId: AssetCategory | null,
  sources: Array<string>,
  lastEvaluatedAt: string | Date | null,
  ageDays: number | null,
}

export interface FindingTableSource {
  evidenceId: string,
  cveId: string | null,
  cveTitle: string | null,
  mitreTechniqueExternalId: string | null,
  mitreTechniqueName: string | null,
  expectationType: ExpectationType | null,
  currentState: EvidenceState,
  stateOrigin: EvidenceHistoryOrigin | null,
  dismissalType: DismissalType | null,
  score: number | null,
  band: SeverityBand | null,
  pendingVector: boolean,
  /** An NVD pass read the CVE and found no usable record: the vector the finding waits on will not come from NVD. */
  nvdRecordMissing: boolean,
  assetName: string | null,
  assetDerivedName: string | null,
  assetCategoryId: AssetCategory | null,
  sources: Array<string>,
  lastEvaluatedAt: string | Date | null,
  firstSeenAt: string | Date | null,
}

export type FindingSortKey = 'score' | 'name' | 'kind' | 'currentState' | 'assetName' | 'assetCategoryId' | 'lastEvaluatedAt' | 'firstSeenAt';

/** A column absent from here must declare `enableSorting: false`, or it offers an ordering the server cannot answer. */
const SORT_BY_COLUMN: Record<string, { sortBy: FindingSortKey, reversed?: true } | undefined> = {
  score: { sortBy: 'score' },
  name: { sortBy: 'name' },
  kind: { sortBy: 'kind' },
  currentState: { sortBy: 'currentState' },
  assetName: { sortBy: 'assetName' },
  assetCategoryId: { sortBy: 'assetCategoryId' },
  lastEvaluatedAt: { sortBy: 'lastEvaluatedAt' },
  // The earlier the first sighting, the greater the age.
  ageDays: { sortBy: 'firstSeenAt', reversed: true },
};

/** The server ordering a findings table sort asks for: the highest score first when it names no sortable column. */
export const toFindingSort = (sort: { id: string, desc: boolean } | undefined): { sortBy: FindingSortKey, sortDesc: boolean } => {
  const column = sort === undefined ? undefined : SORT_BY_COLUMN[sort.id];
  if (sort === undefined || column === undefined) {
    return { sortBy: 'score', sortDesc: true };
  }
  return { sortBy: column.sortBy, sortDesc: column.reversed ? !sort.desc : sort.desc };
};

export const resolveFindingKind = (cveId: string | null, expectationType: ExpectationType | null): FindingKind => {
  if (cveId !== null) {
    return 'vulnerability';
  }
  if (expectationType === 'detection') {
    return 'detection_response';
  }
  return expectationType === 'prevention' ? 'prevention_response' : 'control_response';
};

export const toFindingTableRow = (finding: FindingTableSource, now: Date = new Date()): FindingTableRow => ({
  id: finding.evidenceId,
  name: finding.cveId ?? finding.mitreTechniqueExternalId ?? '',
  detail: finding.cveId === null ? finding.mitreTechniqueName : finding.cveTitle,
  kind: resolveFindingKind(finding.cveId, finding.expectationType),
  currentState: finding.currentState,
  stateOrigin: finding.stateOrigin,
  dismissalType: finding.dismissalType,
  score: finding.score,
  band: finding.band,
  pendingVector: finding.pendingVector,
  nvdRecordMissing: finding.nvdRecordMissing,
  assetName: finding.assetName,
  assetDerivedName: finding.assetDerivedName,
  assetCategoryId: finding.assetCategoryId,
  sources: finding.sources,
  lastEvaluatedAt: finding.lastEvaluatedAt,
  ageDays: daysSince(finding.firstSeenAt, now),
});
