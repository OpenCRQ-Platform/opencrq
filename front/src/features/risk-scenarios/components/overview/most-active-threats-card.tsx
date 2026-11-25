import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { SectionCard } from '../../../../components/shared';
import { ActivityGradeBadge, HiddenThreatsAlert, ThreatTypeBadge } from '../../../threats';
import { useTRPC } from '../../../../lib';
import { rankMostActiveThreats } from './most-active-threats-utils';

interface MostActiveThreatsCardProps {
  riskScenarioId: string,
}

const SKELETON_ROWS = 6;

export const MostActiveThreatsCard: FunctionComponent<MostActiveThreatsCardProps> = ({ riskScenarioId }) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.threats.getRelevantForScenario.queryOptions({ scenarioId: riskScenarioId }));

  const items = data?.items ?? [];
  const topThreats = rankMostActiveThreats(items);

  return (
    <SectionCard title={t`Most Active Threats`} className="h-full" cardClassName="flex-1 p-4">
      <HiddenThreatsAlert />
      {isLoading ? (
        Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-8" />
          </div>
        ))
      ) : items.length === 0 ? (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>No relevant threats identified yet.</Trans>
        </p>
      ) : topThreats.length === 0 ? (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>No relevant threat has a dated activity yet.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {topThreats.map((threat, index) => (
            <li key={threat.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="txt-sub-content text-muted-foreground">{index + 1}</span>
                <Link
                  from="/$tenantId/{-$organizationId}"
                  to="threat-center/threats/$threatId"
                  params={{ threatId: threat.id }}
                  className="truncate font-medium hover:underline"
                >
                  {threat.name}
                </Link>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <ThreatTypeBadge entityType={threat.entityType} />
                <ActivityGradeBadge lastObservedAt={threat.lastObservedAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
};
