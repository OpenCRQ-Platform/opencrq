import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';import { Skeleton } from '@filigran/ui';import type { FunctionComponent } from 'react';
import { ControlIdPill, MetricInfo, SectionCard } from '../../../components/shared';
import { useTRPC } from '../../../lib';

interface AttackOutcomeControlListProps {
  attackOutcomeId: string,
}

/**
 * Controls that reduce this outcome, ordered by the annual loss one simulated upgrade removes.
 * No badge carries a figure or a rank: the per-lever amounts live on each control's own page.
 */
export const AttackOutcomeControlList: FunctionComponent<AttackOutcomeControlListProps> = ({ attackOutcomeId }) => {
  const trpc = useTRPC();
  const { data, isLoading, isError } = useQuery(trpc.crqIndicators.getCrqSummaryForOutcome.queryOptions({ attackOutcomeId }));
  const controls = data?.topControls ?? [];

  if (isLoading) {
    return (
      <SectionCard title={t`Controls that reduce this outcome`}>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </SectionCard>
    );
  }

  // A failed read is not an absence: the empty state below asserts no control has a simulated
  // upgrade against this outcome.
  if (isError) {
    return (
      <SectionCard title={t`Controls that reduce this outcome`}>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Controls could not be loaded.</Trans>
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t`Controls that reduce this outcome`}>
      {controls.length === 0
        ? (
          <p className="txt-sub-content text-muted-foreground">
            <Trans>No control has a simulated upgrade against this outcome yet.</Trans>
          </p>
        )
        : (
          <div className="flex items-center gap-2">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {controls.map((control) => (
                <li key={control.controlId}>
                  <Link
                    from="/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId"
                    to="/$tenantId/{-$organizationId}/controls/$controlId"
                    params={{ controlId: control.controlId }}
                    className="flex items-center gap-2 font-content-base text-content-base text-primary underline-offset-4 hover:underline"
                  >
                    <ControlIdPill externalId={control.externalId} />
                    {control.name}
                  </Link>
                </li>
              ))}
            </ul>
            <MetricInfo
              title={t`Controls that reduce this outcome`}
              what={<Trans>Controls with a simulated upgrade that reduces this outcome.</Trans>}
              how={<Trans>Each upgrade is simulated across this outcome's scenarios. Controls that remove the most annual loss appear first.</Trans>}
              caveat={<Trans>The order sums each control's best lever across the outcome's scenarios. It ranks; it does not price a portfolio.</Trans>}
            />
          </div>
        )}
    </SectionCard>
  );
};
