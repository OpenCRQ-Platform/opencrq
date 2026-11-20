import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { linkOptions } from '@tanstack/react-router';
import { skipToken, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type { RouteTab } from '../../../components/shared';
import type { TefCatalog } from '../threat-event-frequency-utils';
import { DetailPageLayout, InfoTooltip, RouteTabs } from '../../../components/shared';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils/date-utils';
import { threatEventFrequencyListSearchSchema } from '../threat-event-frequency-list-search';
import { hasEmployeeCount } from '../threat-event-frequency-utils';
import { AllScopesFrequency } from './all-scopes-frequency';
import { listOf, profileLabels } from './frequency-labels';
import { ProfileFrequency } from './profile-frequency';
import { ProfileSimulator } from './profile-simulator';

export type ThreatEventFrequencyTab = 'simulator' | 'scopes';

interface ThreatEventFrequencyPageProps {
  /** The risk scope the page opens in, `undefined` on the whole scope. */
  organizationId: string | undefined,
  /** Ignored on a risk scope's page, which has no tabs. */
  tab?: ThreatEventFrequencyTab,
}

const TENANT_PAGE = '/$tenantId/{-$organizationId}/threat-event-frequency';

const tenantTabs = (scopeCount: number): Array<RouteTab> => [
  {
    key: 'simulator',
    label: t`Simulator`,
    linkOption: linkOptions({ from: TENANT_PAGE, to: '.' }),
  },
  {
    key: 'scopes',
    label: i18n._({ id: 'Risk scopes ({scopeCount})', message: 'Risk scopes ({scopeCount})', values: { scopeCount } }),
    linkOption: linkOptions({ from: TENANT_PAGE, to: 'scopes' }),
  },
];

/** The catalogue in force, named as every screen showing a frequency names it. */
const CatalogLine: FunctionComponent<{ catalog: TefCatalog }> = ({ catalog }) => {
  const { version } = catalog;
  const builtOn = formatDate(catalog.builtOn);
  const sources = listOf(catalog.sources.map((source) => source.title));
  return (
    <p className="-mt-4 txt-sub-content text-muted-foreground">
      <Trans>Catalog {version}, {builtOn}. Source: {sources}.</Trans>
    </p>
  );
};

const PageMessage: FunctionComponent<{ title: string, children: ReactNode }> = ({ title, children }) => (
  <DetailPageLayout title={title}>
    <p className="txt-sub-content text-muted-foreground">{children}</p>
  </DetailPageLayout>
);

export const ThreatEventFrequencyPage: FunctionComponent<ThreatEventFrequencyPageProps> = ({ organizationId, tab }) => {
  const trpc = useTRPC();
  const inScope = organizationId !== undefined;
  const { data: catalog, isError } = useQuery(trpc.crqIndicators.getTefCatalog.queryOptions());
  const { data: scope, isError: isScopeError } = useQuery(trpc.organizations.getOrganization.queryOptions(
    { id: organizationId ?? '' },
    { enabled: inScope },
  ));
  const { data: scopes, isError: isScopesError } = useQuery(trpc.organizations.getOrganizations.queryOptions(undefined, { enabled: !inScope }));
  const { data: scenarios, isError: isScenariosError } = useQuery(trpc.crqIndicators.getScopeScenarioTefs.queryOptions(
    { organizationId: organizationId ?? '' },
    { enabled: inScope },
  ));
  const { data: reading, isError: isReadingError } = useQuery(trpc.crqIndicators.getTefCatalogReading.queryOptions(
    scope === undefined || scope === null
      ? skipToken
      : { countryId: scope.countryId, sectorId: scope.sectorId, employeeCount: scope.employeeCount, revenueBand: scope.revenueBand },
  ));
  const { filters } = useUrlListFilters(threatEventFrequencyListSearchSchema);
  const title = t`Threat Event Frequency`;

  if (isError || isScopeError || isScopesError || isScenariosError || isReadingError) {
    return <PageMessage title={title}><Trans>The frequencies could not be loaded.</Trans></PageMessage>;
  }
  if (inScope && scope === null) {
    return <PageMessage title={title}><Trans>This risk scope could not be found.</Trans></PageMessage>;
  }
  if (catalog === undefined || (inScope ? scope === undefined || scenarios === undefined || reading === undefined : scopes === undefined)) {
    return (
      <DetailPageLayout title={title}>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </DetailPageLayout>
    );
  }

  return (
    <DetailPageLayout title={title}>
      <CatalogLine catalog={catalog} />
      {scope !== undefined && scope !== null && reading !== undefined
        ? (
          <ProfileFrequency
            reading={reading}
            labels={profileLabels(catalog, scope)}
            hasEmployeeCount={hasEmployeeCount(scope)}
            scope={{ id: scope.id, scenarios: scenarios ?? [], highlightedOutcomeId: filters.outcome }}
          />
        )
        : (
          <>
            <p className="-mt-3 max-w-[56rem] text-muted-foreground">
              <Trans>How many attack attempts an organization faces per year, by attack outcome, read in the catalog for its country, sector and size. A risk scenario in auto mode starts from its attack outcome's value.</Trans>
              <span className="ml-1.5 inline-flex align-middle">
                <InfoTooltip label={t`What an attempt is`}>
                  <Trans>An attempt is an attack carried out, whether it succeeds or not.</Trans>
                </InfoTooltip>
              </span>
            </p>
            <RouteTabs tabs={tenantTabs(scopes?.length ?? 0)} />
            {tab !== 'scopes'
              ? <ProfileSimulator catalog={catalog} scopes={scopes ?? []} />
              : <AllScopesFrequency catalog={catalog} scopes={scopes ?? []} />}
          </>
        )}
    </DetailPageLayout>
  );
};
