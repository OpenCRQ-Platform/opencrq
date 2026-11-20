import type { ConnectorSource, ThreatEntityType, ThreatSourceKind } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { VisibilityState } from '@tanstack/react-table';
import { getConnectors } from '../../integrations';

/** The connector a kind of threat comes from, null for a kind no connector writes. */
const CONNECTOR_OF_KIND: Record<ThreatSourceKind, ConnectorSource | null> = {
  'connector': 'opencti',
  'default-threats': 'default_threats',
  'stix-import': null,
};

export const sourceKindLabel = (kind: ThreatSourceKind): string => {
  const connector = CONNECTOR_OF_KIND[kind];
  return connector === null ? t`STIX import` : getConnectors()[connector].name;
};

export const THREAT_LIST_INITIAL_COLUMN_VISIBILITY: VisibilityState = { stixCreated: false, updatedAt: false };

export interface ThreatListFilters {
  search: string,
  outcomeId: string | undefined,
  entityType: ThreatEntityType | undefined,
  kind: ThreatSourceKind | undefined,
}

export const isThreatListFiltered = ({ search, outcomeId, entityType, kind }: ThreatListFilters): boolean => (
  search.trim() !== '' || outcomeId !== undefined || entityType !== undefined || kind !== undefined
);

/**
 * Only a settled, unfiltered answer counts. Right after a reset the rows on screen still belong to
 * the filtered query that matched nothing, so its zero is not the catalogue's.
 */
export const isThreatCatalogEmpty = ({ total, filtered, isPlaceholderData }: {
  total: number | undefined,
  filtered: boolean,
  isPlaceholderData: boolean,
}): boolean => total === 0 && !filtered && !isPlaceholderData;

export interface ThreatCatalogVolumes {
  threatActors: number,
  intrusionSets: number,
  campaigns: number,
}

export const threatCatalogTotal = ({ threatActors, intrusionSets, campaigns }: ThreatCatalogVolumes): number => (
  threatActors + intrusionSets + campaigns
);
