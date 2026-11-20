import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { canonicalExternalIdHref } from '../../../../../../../../features/mitre-attack/external-id-path-utils';
import { trpcClient, useTRPC } from '../../../../../../../../lib';
import { CardField, DetailPageLayout, InfoField, SectionCard } from '../../../../../../../../components/shared';
import { EmptyValue } from '../../../../../../../../components/ui/empty-value';
import { MitreDescription } from '../../../../../../../../features/mitre-attack/components/mitre-description';
import { RelatedTechniquesTable } from '../../../../../../../../features/mitre-attack/components/related-techniques-table';

const TacticDetail = () => {
  const trpc = useTRPC();
  const { tactic: initialData } = Route.useLoaderData();

  const { data: tactic } = useQuery(trpc.mitreAttack.getTacticByExternalId.queryOptions(
    { externalId: initialData.externalId },
    { initialData },
  ));

  if (!tactic) {
    return null;
  }

  return (
    <DetailPageLayout title={tactic.name}>
      <div className="grid grid-cols-3 gap-6">
        <SectionCard title={t`Details`} cardClassName="flex-1">
          <div className="flex flex-col gap-6">
            <InfoField title={t`External ID`} value={tactic.externalId} />
            <CardField title={t`Reference`}>
              {tactic.url
                ? <a href={tactic.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{tactic.url}</a>
                : <EmptyValue />}
            </CardField>
          </div>
        </SectionCard>

        <SectionCard title={t`Description`} className="col-span-2" cardClassName="flex-1">
          {tactic.description ? <MitreDescription text={tactic.description} /> : <EmptyValue />}
        </SectionCard>
      </div>

      <SectionCard title={t`Techniques`}>
        <RelatedTechniquesTable
          techniques={tactic.techniques}
          storageKey="tactic.techniques"
          showGrain
          filterable
          emptyState={(
            <p className="txt-sub-content text-default-secondary">
              <Trans>No technique is mapped to this tactic.</Trans>
            </p>
          )}
        />
      </SectionCard>
    </DetailPageLayout>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/tactics/$tacticExternalId')({
  beforeLoad: ({ params, location }) => {
    const href = canonicalExternalIdHref(location, params.tacticExternalId);
    if (href !== null) {
      throw redirect({ href, replace: true });
    }
  },
  loader: async ({ params }) => {
    const tactic = await trpcClient.mitreAttack.getTacticByExternalId.query({ externalId: params.tacticExternalId });
    if (!tactic) {
      throw notFound();
    }
    return { tactic, crumb: tactic.name };
  },
  component: TacticDetail,
});
