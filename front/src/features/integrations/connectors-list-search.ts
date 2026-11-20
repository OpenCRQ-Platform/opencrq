import { CONNECTOR_SCOPE_KINDS, CONNECTOR_STATES } from '@app/module/client';
import { z } from 'zod';
import type { ConnectorFilters } from './connector-list-utils';
import { formatUrlList, parseUrlList } from '../../utils';
import { DOMAIN_ORDER } from './connector-list-utils';

export const CONNECTORS_LIST_SEARCH_DEFAULTS = { search: '', domains: '', scopeKinds: '', states: '' } as const;

/** Each list field carries the comma-joined `formatUrlList` / `parseUrlList` encoding. */
export const connectorsListSearchSchema = z.object({
  search: z.coerce.string().catch('').default(''),
  domains: z.coerce.string().catch('').default(''),
  scopeKinds: z.coerce.string().catch('').default(''),
  states: z.coerce.string().catch('').default(''),
});

type ConnectorsUrlFilters = z.infer<typeof connectorsListSearchSchema>;

/** Drops a facet value the app no longer defines, rather than keeping a selection that can never match anything. */
const toKnownValues = <V extends string>(vocabulary: ReadonlyArray<V>, raw: string): Array<V> => {
  const known = new Set<string>(vocabulary);
  return parseUrlList(raw).filter((value): value is V => known.has(value));
};

/** Parses the comma-joined URL fields into the shape `filterConnectors` / `countConnectorFacets` expect. */
export const toConnectorFilters = (urlFilters: ConnectorsUrlFilters): ConnectorFilters => ({
  search: urlFilters.search,
  domains: toKnownValues(DOMAIN_ORDER, urlFilters.domains),
  scopeKinds: toKnownValues(CONNECTOR_SCOPE_KINDS, urlFilters.scopeKinds),
  states: toKnownValues(CONNECTOR_STATES, urlFilters.states),
});

/** Inverse of {@link toConnectorFilters}, for writing a `ConnectorFilters` back to the address. */
export const toConnectorUrlFilters = (filters: ConnectorFilters): ConnectorsUrlFilters => ({
  search: filters.search,
  domains: formatUrlList([...filters.domains]),
  scopeKinds: formatUrlList([...filters.scopeKinds]),
  states: formatUrlList([...filters.states]),
});
