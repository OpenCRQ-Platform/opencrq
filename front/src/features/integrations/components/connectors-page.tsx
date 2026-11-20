import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { INTEGRATION_SOURCES } from '@app/module/client';
import type { ConnectorDomain, IntegrationSource } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import { LayoutGrid, List } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorListEntry, ConnectorSort, ConnectorTab } from '../connector-list-utils';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  CONNECTOR_SORTS,
  countConnectorFacets,
  filterConnectors,
  groupConnectorsByDomain,
  offersConfigure,
  scopeFiltersToTab,
  sortConnectors,
} from '../connector-list-utils';
import { connectorsListSearchSchema, toConnectorFilters, toConnectorUrlFilters } from '../connectors-list-search';
import { DebouncedSearchField, TooltipHintProvider } from '../../../components/shared';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { useHasManageSecurity, usePersistedView, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { CONNECTOR_DOMAIN_ICON, connectorDomainLabel } from '../connector-vocabulary';
import { CatalogueConnectorCard, DeployedConnectorCard } from './connector-cards';
import { ConfigureIntegrationDrawer } from './configure-integration-drawer';
import { ConnectorFacets } from './connector-facets';
import { ConnectorSectionHeader } from './connector-section';
import { ConnectorStateChip } from './connector-state-chip';
import { getConnectors } from './connectors-list';

const VIEW_STORAGE_KEY = 'integrations-connectors';
const VIEWS = ['grid', 'table'] as const;

const isIntegrationSource = (source: string): source is IntegrationSource =>
  (INTEGRATION_SOURCES as ReadonlyArray<string>).includes(source);

const useConnectorEntries = (): Array<ConnectorListEntry> => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.connectors.listConnectors.queryOptions());
  const copy = getConnectors();
  return (data ?? []).map((row) => ({
    source: row.source,
    name: copy[row.source].name,
    shortDescription: copy[row.source].shortDescription,
    icon: copy[row.source].icon,
    linkOption: copy[row.source].linkOption,
    domain: row.domain,
    mechanism: row.mechanism,
    scopeKinds: row.scopeKinds,
    state: row.state,
    platformConfigured: row.platformConfigured,
    tenantConfigured: row.tenantConfigured,
    enabled: row.enabled,
    activeRun: row.activeRun,
    lastRun: row.lastRun,
    schedule: row.schedule,
  }));
};

/**
 * Binding a service account is the generic flow for the six connectors backed by `integration_settings`.
 * The stream connector configures itself on its own page, so its action goes there instead.
 */
const ConfigureAction: FunctionComponent<{ entry: ConnectorListEntry }> = ({ entry }) => {
  if (!isIntegrationSource(entry.source)) {
    return (
      <Link {...entry.linkOption}>
        <Button type="button"><Trans>Configure</Trans></Button>
      </Link>
    );
  }
  return (
    <ConfigureIntegrationDrawer
      sourceId={entry.source}
      trigger={<Button type="button"><Trans>Configure</Trans></Button>}
    />
  );
};

const RowIdentity: FunctionComponent<{ entry: ConnectorListEntry }> = ({ entry }) => (
  <>
    <img src={entry.icon} alt="" aria-hidden="true" className="size-8 shrink-0 rounded-[var(--fds-radius-sm)] object-contain" />
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="font-content-base-medium text-content-base-medium truncate">{entry.name}</span>
      <span className="font-content-compact text-content-compact truncate text-default-secondary">
        {entry.shortDescription}
      </span>
    </span>
  </>
);

/** Configure stays outside the link: a button nested in an anchor swallows the row's own click. */
const ConnectorRow: FunctionComponent<{
  entry: ConnectorListEntry,
  tab: ConnectorTab,
  canConfigure: boolean,
}> = ({ entry, tab, canConfigure }) => (
  tab === 'deployed'
    ? (
      <div className="flex items-center gap-2 border-b border-[var(--fds-border-elevation-subtle-soft)]">
        <Link
          {...entry.linkOption}
          className="flex min-w-0 flex-1 items-center gap-4 px-2 py-3 no-underline hover:bg-elevation-hover"
        >
          <RowIdentity entry={entry} />
          <ConnectorStateChip state={entry.state} enabled={entry.enabled} />
        </Link>
        {offersConfigure(entry.state, canConfigure) && (
          <span className="shrink-0 pr-2"><ConfigureAction entry={entry} /></span>
        )}
      </div>
    )
    : (
      <div className="flex items-center border-b border-[var(--fds-border-elevation-subtle-soft)]">
        <Link
          {...entry.linkOption}
          className="flex min-w-0 flex-1 items-center gap-4 px-2 py-3 no-underline hover:bg-elevation-hover"
        >
          <RowIdentity entry={entry} />
          <span className="font-content-compact text-content-compact shrink-0 text-default-secondary">
            <Trans>Not configured in this deployment</Trans>
          </span>
        </Link>
      </div>
    )
);

const SectionIcon: FunctionComponent<{ domain: ConnectorDomain }> = ({ domain }) => {
  const Icon = CONNECTOR_DOMAIN_ICON[domain];
  return <Icon className="size-3.5" />;
};

export const ConnectorsPage: FunctionComponent<{ tab: ConnectorTab }> = ({ tab }) => {
  const { filters: urlFilters, setFilters: setUrlFilters } = useUrlListFilters(connectorsListSearchSchema);
  const filters = scopeFiltersToTab(toConnectorFilters(urlFilters), tab);
  // The sort is a display preference, not a filter: it stays local, out of the address.
  const [sort, setSort] = useState<ConnectorSort>('name_asc');
  const { view, setView } = usePersistedView(VIEW_STORAGE_KEY, 'grid', VIEWS);
  const canConfigure = useHasManageSecurity();

  const viewItems: Array<IconButtonGroupItem<'grid' | 'table'>> = [
    { value: 'grid', icon: <LayoutGrid className="size-4" />, tooltip: t`Cards view` },
    { value: 'table', icon: <List className="size-4" />, tooltip: t`Lines view` },
  ];

  const entries = useConnectorEntries();
  // Disjoint by construction: the deployment either carries a connector's credentials or it does not.
  const onTab = entries.filter((entry) => (tab === 'deployed' ? entry.platformConfigured : !entry.platformConfigured));
  const counts = countConnectorFacets(onTab, filters);
  const sections = groupConnectorsByDomain(sortConnectors(filterConnectors(onTab, filters), sort));
  const matched = sections.reduce((total, section) => total + section.connectors.length, 0);

  return (
    <TooltipHintProvider>
      <div className="grid grid-cols-[232px_1fr] items-start gap-5">
        <ConnectorFacets
          counts={counts}
          filters={filters}
          onChange={(nextFilters) => setUrlFilters(toConnectorUrlFilters(nextFilters))}
          withStatus={tab === 'deployed'}
        />

        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <DebouncedSearchField
              value={urlFilters.search}
              onCommit={(search) => setUrlFilters({ search })}
              placeholder={t`Search these results...`}
              aria-label={t`Search connectors`}
              clearLabel={t`Clear search`}
            />
            <Select value={sort} onValueChange={(value) => setSort(CONNECTOR_SORTS.find((option) => option === value) ?? 'name_asc')}>
              <SelectTrigger aria-label={t`Sort by`} className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">{t`Name (A-Z)`}</SelectItem>
                <SelectItem value="name_desc">{t`Name (Z-A)`}</SelectItem>
                {tab === 'deployed' && <SelectItem value="state">{t`Needs attention first`}</SelectItem>}
              </SelectContent>
            </Select>
            <span className="font-content-compact text-content-compact ml-auto rounded-[var(--fds-radius-sm)] bg-elevation-highlight px-3 py-1 text-default-secondary">
              <Trans>{matched} results</Trans>
            </span>
            <IconButtonGroup items={viewItems} value={view} onChange={setView} />
          </div>

          {matched === 0 && (
            <p className="font-content-base text-content-base text-default-secondary">
              <Trans>No connector matches these filters.</Trans>
            </p>
          )}

          {sections.map((section) => (
            <ConnectorSectionHeader
              key={section.domain}
              title={connectorDomainLabel(section.domain)}
              icon={<SectionIcon domain={section.domain} />}
              count={section.connectors.length}
            >
              {view === 'grid' ? (
                // `md:grid-cols-2` is shipped unlayered by `fds.css` since design system 1.0.0, so it beats
                // the `xl` rule and pins the grid at two cards. The arbitrary form is a name the design
                // system does not generate, so nothing competes for it.
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-3">
                  {section.connectors.map((entry) => (tab === 'deployed'
                    ? (
                      <DeployedConnectorCard
                        key={entry.source}
                        entry={entry}
                        configureAction={offersConfigure(entry.state, canConfigure)
                          ? <ConfigureAction entry={entry} />
                          : null}
                      />
                    )
                    : <CatalogueConnectorCard key={entry.source} entry={entry} />))}
                </div>
              ) : (
                <div className="flex flex-col">
                  {section.connectors.map((entry) => (
                    <ConnectorRow key={entry.source} entry={entry} tab={tab} canConfigure={canConfigure} />
                  ))}
                </div>
              )}
            </ConnectorSectionHeader>
          ))}
        </div>
      </div>
    </TooltipHintProvider>
  );
};
