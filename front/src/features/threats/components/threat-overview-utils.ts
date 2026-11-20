import type { ThreatEntityType } from '@app/module/client';
import { compareText, includesFolded } from '@app/utils/text-fold';

export interface OverviewSector {
  id: string,
  name: string,
  matchesOrganization: boolean,
}

export interface SectorTiles<T extends OverviewSector> {
  shown: Array<T>,
  hiddenCount: number,
}

/** The sectors that concern the tenant lead, then by name; past `max` they are only counted. */
export const pickSectorTiles = <T extends OverviewSector>(sectors: ReadonlyArray<T>, max: number): SectorTiles<T> => {
  const ordered = [...sectors].sort((a, b) => Number(b.matchesOrganization) - Number(a.matchesOrganization) || compareText(a.name, b.name));
  // A "+1" tile would take the room of the one sector it hides.
  const shownCount = ordered.length > max ? max - 1 : ordered.length;
  return { shown: ordered.slice(0, shownCount), hiddenCount: ordered.length - shownCount };
};

export type AttributionRelation = 'attributed-to' | 'attributed-from';

export interface AttributionReference {
  id: string,
  name: string,
  entityType: ThreatEntityType,
}

export interface AttributionRow {
  /** One threat can sit on both sides of the relation, so the row id carries the side. */
  id: string,
  threatId: string,
  name: string,
  entityType: ThreatEntityType,
  relation: AttributionRelation,
}

export const buildAttributionRows = (
  attributedTo: ReadonlyArray<AttributionReference>,
  attributedFrom: ReadonlyArray<AttributionReference>,
): Array<AttributionRow> => [
  ...attributedTo.map((threat) => ({ id: `to:${threat.id}`, threatId: threat.id, name: threat.name, entityType: threat.entityType, relation: 'attributed-to' as const })),
  ...attributedFrom.map((threat) => ({ id: `from:${threat.id}`, threatId: threat.id, name: threat.name, entityType: threat.entityType, relation: 'attributed-from' as const })),
];

export interface OverviewOutcome {
  attackOutcomeId: string,
  outcomeName: string,
  score: number,
}

export interface OutcomeRows<T extends OverviewOutcome> {
  rows: Array<T>,
  /** Outcomes the search keeps but the table leaves out until the reader asks for them. */
  unmatchedCount: number,
}

/** Best match first; the outcomes the threat matches not at all stay out unless `includeUnmatched`. */
export const selectOutcomeRows = <T extends OverviewOutcome>(
  outcomes: ReadonlyArray<T>,
  search: string,
  includeUnmatched: boolean,
): OutcomeRows<T> => {
  const searched = outcomes
    .filter((outcome) => includesFolded(outcome.outcomeName, search))
    .sort((a, b) => b.score - a.score || compareText(a.outcomeName, b.outcomeName));
  const matched = searched.filter((outcome) => outcome.score > 0);
  const unmatchedCount = searched.length - matched.length;
  return { rows: includeUnmatched ? searched : matched, unmatchedCount };
};
