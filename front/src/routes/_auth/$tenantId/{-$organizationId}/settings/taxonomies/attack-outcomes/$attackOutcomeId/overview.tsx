import { plural, t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../../../../../../lib';
import {
  AttackOutcomeControlList,
  AttackOutcomeExposure,
  AttackOutcomeThreatInTheWild,
} from '../../../../../../../../features/attack-outcomes';
import { CriteriaReachedChips, CriteriaReachedLegend } from '../../../../../../../../features/asset-dependencies';
import { CardField, DescriptionField, InfoField, SectionCard } from '../../../../../../../../components/shared';
import { Route as AttackOutcomeRoute } from './route';

const AttackOutcomeOverview = () => {
  const trpc = useTRPC();
  const { attackOutcome: initialData } = AttackOutcomeRoute.useLoaderData();

  const { data: attackOutcome } = useQuery(trpc.attackOutcomes.getAttackOutcome.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!attackOutcome) {
    return null;
  }

  const referenceDwellDays = Math.round(attackOutcome.referenceDwellDays);

  return (
    <>
      <SectionCard title={t`Details`}>
        <DescriptionField title={t`Description`} value={attackOutcome.description} />
        <InfoField title={t`Reference dwell`} value={plural(referenceDwellDays, { one: '# day', other: '# days' })} />
        <CardField title={<span className="flex items-center gap-1.5">{t`Criteria reached`}<CriteriaReachedLegend /></span>}>
          <CriteriaReachedChips
            criteria={{
              availability: attackOutcome.reachesAvailability,
              integrity: attackOutcome.reachesIntegrity,
              confidentiality: attackOutcome.reachesConfidentiality,
              traceability: attackOutcome.reachesTraceability,
            }}
          />
        </CardField>
      </SectionCard>
      <div className="grid grid-cols-2 gap-6">
        <AttackOutcomeExposure attackOutcomeId={attackOutcome.id} />
        <AttackOutcomeThreatInTheWild attackOutcomeId={attackOutcome.id} />
      </div>
      <AttackOutcomeControlList attackOutcomeId={attackOutcome.id} />
    </>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: AttackOutcomeOverview,
});
