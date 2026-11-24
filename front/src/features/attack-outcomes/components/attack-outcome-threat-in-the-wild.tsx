import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Skeleton } from '@filigran/ui';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { SectionCard } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { HiddenThreatsAlert } from '../../threats';
import { AttackOutcomeTopThreats } from './attack-outcome-top-threats';
import { ThreatDistributionBar } from './threat-distribution-bar';

interface AttackOutcomeThreatInTheWildProps {
  attackOutcomeId: string,
}

/**
 * "Who is coming for this outcome": every matching actor, its probability of leading to this outcome and how it
 * distributes over the free-text STIX fields the platform ingested. Bars are drawn over every
 * matching actor, not the top five the table below shows.
 */
export const AttackOutcomeThreatInTheWild: FunctionComponent<AttackOutcomeThreatInTheWildProps> = ({
  attackOutcomeId,
}) => {
  const trpc = useTRPC();
  const { data, isLoading, isError } = useQuery(trpc.threats.getMatchingActorsForOutcome.queryOptions({ attackOutcomeId }));

  if (isLoading) {
    return (
      <SectionCard title={t`Threat in the wild`}>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-3 w-full" />
        </div>
      </SectionCard>
    );
  }

  // A failed read is not an absence: the empty state below asserts nobody matches this outcome,
  // which the page does not know once the query has failed.
  if (isError) {
    return (
      <SectionCard title={t`Threat in the wild`}>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Matching threats could not be loaded.</Trans>
        </p>
      </SectionCard>
    );
  }

  if (!data || data.matchingCount === 0) {
    return (
      <SectionCard title={t`Threat in the wild`}>
        <HiddenThreatsAlert />
        <p className="txt-sub-content text-muted-foreground">
          <Trans>No threat matches this outcome yet.</Trans>
        </p>
      </SectionCard>
    );
  }

  const { topActors, distributions, matchingCount } = data;

  return (
    <SectionCard title={t`Threat in the wild`}>
      <HiddenThreatsAlert />
      <ThreatDistributionBar
        label={plural(matchingCount, {
          one: 'Resource level of the # matching set',
          other: 'Resource level of the # matching sets',
        })}
        field="resourceLevel"
        buckets={distributions.resourceLevel}
      />
      <ThreatDistributionBar
        label={plural(matchingCount, {
          one: 'Primary motivation of the # matching set',
          other: 'Primary motivation of the # matching sets',
        })}
        field="primaryMotivation"
        buckets={distributions.primaryMotivation}
      />
      <AttackOutcomeTopThreats attackOutcomeId={attackOutcomeId} threats={topActors} />
    </SectionCard>
  );
};
