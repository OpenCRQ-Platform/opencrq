import { Button, Skeleton, SkeletonGroup } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import { SectionCard } from '../../components/shared';
import { ListEmptyCard } from '../../components/ui/list-empty-card';
import { useTRPC } from '../../lib';

type Hit = { id: string, name: string | null };

type HitPage = { hits: Array<Hit>, total: number };

/**
 * One entity type of the results: the count is the true number of matches, not the length of the
 * first page; when the page is cut, "View all" opens the type's list with the search applied.
 */
const HitList: FunctionComponent<{ title: string, page: HitPage, render: (hit: Hit) => ReactNode, viewAll?: ReactNode }> = ({ title, page, render, viewAll }) => (
  <SectionCard
    title={title}
    titleVariant="inside"
    titleAdornment={page.total}
    headerAction={page.total > page.hits.length ? viewAll : undefined}
  >
    <ul className="flex flex-col gap-1">
      {page.hits.map((hit) => (
        <li key={hit.id} className="txt-body2 truncate">{render(hit)}</li>
      ))}
    </ul>
  </SectionCard>
);

const GlobalSearchPending: FunctionComponent = () => (
  <SkeletonGroup loading label={t`Loading`} className="flex flex-col gap-6">
    <Skeleton className="h-8 w-64 max-w-full" />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  </SkeletonGroup>
);

/**
 * The results of the header's "Search the platform": the first matches of each entity type of the
 * tenant on screen, each linking to its page; a type with no match is left out.
 */
export const GlobalSearchPage: FunctionComponent<{ tenantId: string, search: string }> = ({ tenantId, search }) => {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(trpc.globalSearch.search.queryOptions({ search }, { enabled: search.length > 0 }));

  if (search.length === 0) {
    return (
      <ListEmptyCard
        title={t`Search the platform`}
        body={t`Type a search in the header to find risk scenarios, assets, threats, risk scopes and controls.`}
        actions={null}
      />
    );
  }
  if (isPending) {
    return <GlobalSearchPending />;
  }
  const title = <h1 className="txt-title font-semibold">{t`Results for “${search}”`}</h1>;
  const total = data === undefined ? 0 : data.riskScenarios.total + data.primaryAssets.total + data.supportingAssets.total
    + data.threats.total + data.organizations.total + data.controls.total;
  if (data === undefined || total === 0) {
    return (
      <div className="flex flex-col gap-6">
        {title}
        <ListEmptyCard
          title={t`Nothing matches this search`}
          body={t`No risk scenario, asset, threat, risk scope or control of this tenant has a name that contains “${search}”. Check the spelling, or open a list to browse what the tenant holds.`}
          actions={(
            <>
              <Button asChild priority="secondary">
                <Link to="/$tenantId/{-$organizationId}/risk-scenarios" params={{ tenantId }}>{t`Open risk scenarios`}</Link>
              </Button>
              <Button asChild priority="secondary">
                <Link to="/$tenantId/{-$organizationId}/assets" params={{ tenantId }}>{t`Open assets`}</Link>
              </Button>
            </>
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {title}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {data.riskScenarios.total > 0 && (
          <HitList
            title={t`Risk Scenarios`}
            page={data.riskScenarios}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId" params={{ tenantId, riskScenarioId: hit.id }} className="text-primary hover:underline">{hit.name}</Link>
            )}
            viewAll={(
              <Link to="/$tenantId/{-$organizationId}/risk-scenarios" params={{ tenantId }} className="text-primary hover:underline">{t`View all`}</Link>
            )}
          />
        )}
        {data.primaryAssets.total > 0 && (
          <HitList
            title={t`Primary Assets`}
            page={data.primaryAssets}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId" params={{ tenantId, primaryAssetId: hit.id }} className="text-primary hover:underline">{hit.name}</Link>
            )}
            viewAll={(
              <Link to="/$tenantId/{-$organizationId}/primary-assets" params={{ tenantId }} search={{ search }} className="text-primary hover:underline">{t`View all`}</Link>
            )}
          />
        )}
        {data.supportingAssets.total > 0 && (
          <HitList
            title={t`Assets`}
            page={data.supportingAssets}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/assets/$supportingAssetId" params={{ tenantId, supportingAssetId: hit.id }} className="text-primary hover:underline">{hit.name}</Link>
            )}
            viewAll={(
              <Link to="/$tenantId/{-$organizationId}/assets" params={{ tenantId }} search={{ search }} className="text-primary hover:underline">{t`View all`}</Link>
            )}
          />
        )}
        {data.threats.total > 0 && (
          <HitList
            title={t`Threats`}
            page={data.threats}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/threat-center/threats/$threatId" params={{ tenantId, threatId: hit.id }} className="text-primary hover:underline">{hit.name}</Link>
            )}
            viewAll={(
              <Link to="/$tenantId/{-$organizationId}/threat-center" params={{ tenantId }} search={{ search }} className="text-primary hover:underline">{t`View all`}</Link>
            )}
          />
        )}
        {data.organizations.total > 0 && (
          <HitList
            title={t`Risk scopes`}
            page={data.organizations}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}" params={{ tenantId, organizationId: hit.id }} className="text-primary hover:underline">{hit.name}</Link>
            )}
            viewAll={(
              <Link to="/$tenantId/{-$organizationId}/risk-scopes" params={{ tenantId }} className="text-primary hover:underline">{t`View all`}</Link>
            )}
          />
        )}
        {data.controls.total > 0 && (
          <HitList
            title={t`Controls`}
            page={data.controls}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/controls" params={{ tenantId }} search={{ search: hit.name ?? '' }} className="text-primary hover:underline">{hit.name}</Link>
            )}
            viewAll={(
              <Link to="/$tenantId/{-$organizationId}/controls" params={{ tenantId }} search={{ search }} className="text-primary hover:underline">{t`View all`}</Link>
            )}
          />
        )}
      </div>
    </div>
  );
};
