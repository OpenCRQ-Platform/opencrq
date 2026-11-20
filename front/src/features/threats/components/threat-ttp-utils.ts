import { compareText, includesFolded } from '@app/utils/text-fold';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';

export interface ThreatTechniqueTactic {
  id: string,
  externalId: string,
  name: string,
}

/** A technique of the threat matched to the MITRE catalogue, keyed on the catalogue's technique id. */
export interface ThreatTechniqueRow {
  id: string,
  externalId: string,
  name: string,
  citedExternalIds: Array<string>,
  tactics: Array<ThreatTechniqueTactic>,
  openctiStixRelationId: string | null,
}

export interface ThreatTechniqueFilters {
  search: string,
  /** `null` keeps every tactic. */
  tacticId: string | null,
}

/** The tactics the techniques fall under, each once, by name. */
export const tacticsOfTechniques = (techniques: ReadonlyArray<ThreatTechniqueRow>): Array<ThreatTechniqueTactic> => {
  const byId = new Map<string, ThreatTechniqueTactic>();
  for (const tactic of techniques.flatMap((technique) => technique.tactics)) {
    byId.set(tactic.id, tactic);
  }
  return [...byId.values()].sort((a, b) => compareText(a.name, b.name));
};

/** A revoked id the threat cited a technique through finds that technique too. */
export const filterThreatTechniques = (
  techniques: ReadonlyArray<ThreatTechniqueRow>,
  { search, tacticId }: ThreatTechniqueFilters,
): Array<ThreatTechniqueRow> => techniques.filter((technique) =>
  (tacticId === null || technique.tactics.some((tactic) => tactic.id === tacticId))
  && (includesFolded(technique.externalId, search)
    || includesFolded(technique.name, search)
    || technique.citedExternalIds.some((citedExternalId) => includesFolded(citedExternalId, search))));

/**
 * The note a technique row of an actor carries when the actor cited it through revoked ATT&CK IDs,
 * naming them all; `null` when the actor cited the technique only as it is.
 */
export const revokedCitationNote = (externalId: string, citedExternalIds: ReadonlyArray<string>): string | null => {
  const revoked = citedExternalIds.filter((citedExternalId) => citedExternalId !== externalId);
  if (revoked.length === 0) {
    return null;
  }
  const revokedIds = new Intl.ListFormat(i18n.locale || 'en', { type: 'conjunction' }).format(revoked);
  const revokedCount = revoked.length;
  return citedExternalIds.includes(externalId)
    ? t`Also cited as ${revokedIds}, ${plural(revokedCount, { one: 'a revoked ATT&CK ID', other: 'revoked ATT&CK IDs' })}`
    : t`Cited as ${revokedIds}, ${plural(revokedCount, { one: 'a revoked ATT&CK ID', other: 'revoked ATT&CK IDs' })}`;
};
