import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import { SectionCard } from '../../components/shared';
import { useTRPC } from '../../lib';

type Hit = { id: string, name: string | null };

const HitList: FunctionComponent<{ title: string, hits: Array<Hit>, render: (hit: Hit) => ReactNode }> = ({ title, hits, render }) => (
  <SectionCard title={title} titleVariant="inside" titleAdornment={hits.length}>
    <ul className="flex flex-col gap-1">
      {hits.map((hit) => (
        <li key={hit.id} className="txt-body2 truncate">{render(hit)}</li>
      ))}
    </ul>
  </SectionCard>
);

const linkClass = 'text-primary hover:underline';

/**
 * The results of the header's "Search the platform": the first matches of each entity type of the
 * tenant on screen, each linking to its page; a type with no match is left out.
 */
export const GlobalSearchPage: FunctionComponent<{ tenantId: string, search: string }> = ({ tenantId, search }) => {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(trpc.globalSearch.search.queryOptions({ search }, { enabled: search.length > 0 }));

  if (search.length > 0 && isPending) {
    return <p className="txt-body2 text-muted-foreground">{t`Loading...`}</p>;
  }
  const total = data === undefined ? 0 : data.riskScenarios.length + data.primaryAssets.length + data.supportingAssets.length
    + data.threats.length + data.organizations.length + data.controls.length;
  if (search.length === 0 || data === undefined || total === 0) {
    return <p className="txt-body2 text-muted-foreground">{t`No results`}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="txt-title font-semibold">{t`Results for “${search}”`}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {data.riskScenarios.length > 0 && (
          <HitList
            title={t`Risk Scenarios`}
            hits={data.riskScenarios}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId" params={{ tenantId, riskScenarioId: hit.id }} className={linkClass}>{hit.name}</Link>
            )}
          />
        )}
        {data.primaryAssets.length > 0 && (
          <HitList
            title={t`Primary Assets`}
            hits={data.primaryAssets}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId" params={{ tenantId, primaryAssetId: hit.id }} className={linkClass}>{hit.name}</Link>
            )}
          />
        )}
        {data.supportingAssets.length > 0 && (
          <HitList
            title={t`Assets`}
            hits={data.supportingAssets}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/assets/$supportingAssetId" params={{ tenantId, supportingAssetId: hit.id }} className={linkClass}>{hit.name}</Link>
            )}
          />
        )}
        {data.threats.length > 0 && (
          <HitList
            title={t`Threats`}
            hits={data.threats}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/threat-center/threats/$threatId" params={{ tenantId, threatId: hit.id }} className={linkClass}>{hit.name}</Link>
            )}
          />
        )}
        {data.organizations.length > 0 && (
          <HitList
            title={t`Risk scopes`}
            hits={data.organizations}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}" params={{ tenantId, organizationId: hit.id }} className={linkClass}>{hit.name}</Link>
            )}
          />
        )}
        {data.controls.length > 0 && (
          <HitList
            title={t`Controls`}
            hits={data.controls}
            render={(hit) => (
              <Link to="/$tenantId/{-$organizationId}/controls" params={{ tenantId }} search={{ search: hit.name ?? '' }} className={linkClass}>{hit.name}</Link>
            )}
          />
        )}
      </div>
    </div>
  );
};
