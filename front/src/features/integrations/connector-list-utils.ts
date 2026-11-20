import { includesFolded } from '@app/utils/text-fold';
import { CONNECTOR_SCOPE_KINDS, CONNECTOR_STATES } from '@app/module/client';
import type { ConnectorLinkOption } from './components/connectors-list';
import type {
  ConnectorDomain,
  ConnectorMechanism,
  ConnectorScopeKind,
  ConnectorSource,
  ConnectorState,
  ScheduleCadence,
} from '@app/module/client';

/** The order sections appear in, and the order the Domain facet lists its rows. */
export const DOMAIN_ORDER: ReadonlyArray<ConnectorDomain> = [
  'vulnerability',
  'simulation',
  'compliance',
  'threat_intelligence',
];

/**
 * What needs attention first. A connector the tenant cannot act on sinks to the bottom, and a state
 * that asks for a gesture rises above one that asks for nothing.
 */
const STATE_ATTENTION_ORDER: ReadonlyArray<ConnectorState> = [
  'failing',
  'never_synced',
  'syncing',
  'not_configured',
  'healthy',
  'unavailable',
];

export const CONNECTOR_SORTS = ['name_asc', 'name_desc', 'state'] as const;
export type ConnectorSort = (typeof CONNECTOR_SORTS)[number];

export interface FacetableConnector {
  name: string,
  shortDescription: string,
  domain: ConnectorDomain,
  scopeKinds: ReadonlyArray<ConnectorScopeKind>,
  state: ConnectorState,
}

export interface ConnectorRunRead {
  status: string,
  startedAt: string | null,
  finishedAt: string | null,
  processedTotal: number,
  expectedTotal: number | null,
}

/** One row of either tab: the inventory's machine facts, the copy, and what the backend read. */
export interface ConnectorListEntry extends FacetableConnector {
  source: ConnectorSource,
  icon: string,
  linkOption: ConnectorLinkOption,
  mechanism: ConnectorMechanism,
  platformConfigured: boolean,
  tenantConfigured: boolean,
  enabled: boolean,
  activeRun: ConnectorRunRead | null,
  lastRun: ConnectorRunRead | null,
  schedule: { cadence: ScheduleCadence, nextRunAt: string | null } | null,
}

export interface ConnectorFilters {
  search: string,
  domains: ReadonlyArray<ConnectorDomain>,
  scopeKinds: ReadonlyArray<ConnectorScopeKind>,
  states: ReadonlyArray<ConnectorState>,
}

export const EMPTY_CONNECTOR_FILTERS: ConnectorFilters = {
  search: '',
  domains: [],
  scopeKinds: [],
  states: [],
};

export type ConnectorTab = 'deployed' | 'available';

/**
 * The Available tab shows no status facet, so a `states` an address carries there would filter the
 * list with no control to clear it. Dropping the field from that route's schema is not enough: the
 * router keeps a search param no route claims.
 */
export const scopeFiltersToTab = (filters: ConnectorFilters, tab: ConnectorTab): ConnectorFilters =>
  (tab === 'deployed' ? filters : { ...filters, states: [] });

/**
 * The list offers Configure only as the shortcut to a connector the tenant has not bound yet,
 * reconfiguring being the detail page's. Binding a service account is refused without MANAGE_SECURITY.
 */
export const offersConfigure = (state: ConnectorState, hasManageSecurity: boolean): boolean =>
  hasManageSecurity && state === 'not_configured';

export interface ConnectorFacetCounts {
  domains: ReadonlyMap<ConnectorDomain, number>,
  scopeKinds: ReadonlyMap<ConnectorScopeKind, number>,
  states: ReadonlyMap<ConnectorState, number>,
}

export interface ConnectorSection<T> {
  domain: ConnectorDomain,
  connectors: Array<T>,
}

const matchesSearch = (connector: FacetableConnector, search: string): boolean =>
  includesFolded(`${connector.name} ${connector.shortDescription}`, search);

/** An empty group selects everything: a facet nobody ticked narrows nothing. */
const matchesGroup = <V>(selected: ReadonlyArray<V>, held: ReadonlyArray<V>): boolean =>
  selected.length === 0 || held.some((value) => selected.includes(value));

export const filterConnectors = <T extends FacetableConnector>(
  connectors: ReadonlyArray<T>,
  filters: ConnectorFilters,
): Array<T> => connectors.filter((connector) =>
  matchesSearch(connector, filters.search)
    && matchesGroup(filters.domains, [connector.domain])
    && matchesGroup(filters.scopeKinds, connector.scopeKinds)
    && matchesGroup(filters.states, [connector.state]));

const tally = <V extends string>(
  vocabulary: ReadonlyArray<V>,
  connectors: ReadonlyArray<FacetableConnector>,
  held: (connector: FacetableConnector) => ReadonlyArray<V>,
): ReadonlyMap<V, number> => {
  const counts = new Map<V, number>(vocabulary.map((value) => [value, 0]));
  connectors.forEach((connector) => {
    new Set(held(connector)).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  });
  return counts;
};

/**
 * How many connectors each facet row would leave. A group is counted with its own selection lifted,
 * so ticking one domain does not zero every other row and strand the user on it.
 */
export const countConnectorFacets = (
  connectors: ReadonlyArray<FacetableConnector>,
  filters: ConnectorFilters,
): ConnectorFacetCounts => ({
  domains: tally(DOMAIN_ORDER, filterConnectors(connectors, { ...filters, domains: [] }), (c) => [c.domain]),
  scopeKinds: tally(CONNECTOR_SCOPE_KINDS, filterConnectors(connectors, { ...filters, scopeKinds: [] }), (c) => c.scopeKinds),
  states: tally(CONNECTOR_STATES, filterConnectors(connectors, { ...filters, states: [] }), (c) => [c.state]),
});

const byName = (a: FacetableConnector, b: FacetableConnector): number => a.name.localeCompare(b.name);

export const sortConnectors = <T extends FacetableConnector>(
  connectors: ReadonlyArray<T>,
  sort: ConnectorSort,
): Array<T> => {
  const sorted = [...connectors];
  if (sort === 'name_desc') {
    return sorted.sort((a, b) => byName(b, a));
  }
  if (sort === 'state') {
    return sorted.sort((a, b) =>
      STATE_ATTENTION_ORDER.indexOf(a.state) - STATE_ATTENTION_ORDER.indexOf(b.state) || byName(a, b));
  }
  return sorted.sort(byName);
};

/** Sections in the declared domain order, each keeping the order its connectors arrived in. */
export const groupConnectorsByDomain = <T extends FacetableConnector>(
  connectors: ReadonlyArray<T>,
): Array<ConnectorSection<T>> => DOMAIN_ORDER
  .map((domain) => ({ domain, connectors: connectors.filter((connector) => connector.domain === domain) }))
  .filter((section) => section.connectors.length > 0);
