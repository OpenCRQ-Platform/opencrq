import type { ExpectationType, SeverityBand } from '@app/module/client';
import { roundPercentPoints } from '@app/utils/decimals';
import { daysSince } from '../../utils';
import { formatVulnerabilityToken, vulnerabilityFilterOf } from './vulnerability-filter-utils';

export interface UniqueFindingTableRow {
  id: string,
  /** The CVE id, or the technique's ATT&CK id. */
  name: string,
  /** The CVE title, or the technique's name. */
  detail: string | null,
  isTechnique: boolean,
  expectationType: ExpectationType | null,
  /** Null on a technique group, whose findings carry no score, and on a CVE group pending a vector. */
  score: number | null,
  band: SeverityBand | null,
  worstScore: number | null,
  worstBand: SeverityBand | null,
  pendingVector: boolean,
  affectedAssetCount: number,
  /** Null on a technique group, which no catalogue lists. */
  knownExploited: boolean | null,
  epssPercent: number | null,
  sources: Array<string>,
  ageDays: number | null,
  vulnerabilityToken: string | null,
}

export interface UniqueFindingTableSource {
  key: string,
  cveId: string | null,
  cveTitle: string | null,
  knownExploited: boolean | null,
  epss: number | null,
  mitreTechniqueExternalId: string | null,
  mitreTechniqueName: string | null,
  expectationType: ExpectationType | null,
  score: number | null,
  band: SeverityBand | null,
  worstScore: number | null,
  worstBand: SeverityBand | null,
  pendingVector: boolean,
  affectedAssetCount: number,
  sources: Array<string>,
  /** Null on a CVE the estate does not carry. */
  firstSeenAt: string | Date | null,
}

export const toUniqueFindingTableRow = (group: UniqueFindingTableSource, now: Date = new Date()): UniqueFindingTableRow => {
  const filter = vulnerabilityFilterOf(group);
  return {
    id: group.key,
    name: group.cveId ?? group.mitreTechniqueExternalId ?? '',
    detail: group.cveId === null ? group.mitreTechniqueName : group.cveTitle,
    isTechnique: group.cveId === null,
    expectationType: group.expectationType,
    score: group.score,
    band: group.band,
    worstScore: group.worstScore,
    worstBand: group.worstBand,
    pendingVector: group.pendingVector,
    affectedAssetCount: group.affectedAssetCount,
    knownExploited: group.knownExploited,
    epssPercent: group.epss === null ? null : roundPercentPoints(group.epss, 0),
    sources: group.sources,
    ageDays: daysSince(group.firstSeenAt, now),
    vulnerabilityToken: filter === null ? null : formatVulnerabilityToken(filter),
  };
};
