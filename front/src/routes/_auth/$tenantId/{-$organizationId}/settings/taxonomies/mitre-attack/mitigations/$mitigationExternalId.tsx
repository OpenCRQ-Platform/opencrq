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

const MitigationDetail = () => {
  const trpc = useTRPC();
  const { mitigation: initialData } = Route.useLoaderData();

  const { data: mitigation } = useQuery(trpc.mitreAttack.getMitigationByExternalId.queryOptions(
    { externalId: initialData.externalId },
    { initialData },
  ));

  if (!mitigation) {
    return null;
  }

  return (
    <DetailPageLayout title={mitigation.name}>
      <div className="grid grid-cols-3 gap-6">
        <SectionCard title={t`Details`} cardClassName="flex-1">
          <div className="flex flex-col gap-6">
            <InfoField title={t`External ID`} value={mitigation.externalId} />
            <CardField title={t`Reference`}>
              {mitigation.url
                ? <a href={mitigation.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{mitigation.url}</a>
                : <EmptyValue />}
            </CardField>
          </div>
        </SectionCard>

        <SectionCard title={t`Description`} className="col-span-2" cardClassName="flex-1">
          {mitigation.description ? <MitreDescription text={mitigation.description} /> : <EmptyValue />}
        </SectionCard>
      </div>

      <SectionCard title={t`Techniques`}>
        <RelatedTechniquesTable
          techniques={mitigation.techniques}
          storageKey="mitigation.techniques"
          showGrain
          filterable
          emptyState={(
            <p className="txt-sub-content text-default-secondary">
              <Trans>This mitigation addresses no technique.</Trans>
            </p>
          )}
        />
      </SectionCard>
    </DetailPageLayout>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/mitigations/$mitigationExternalId')({
  beforeLoad: ({ params, location }) => {
    const href = canonicalExternalIdHref(location, params.mitigationExternalId);
    if (href !== null) {
      throw redirect({ href, replace: true });
    }
  },
  loader: async ({ params }) => {
    const mitigation = await trpcClient.mitreAttack.getMitigationByExternalId.query({ externalId: params.mitigationExternalId });
    if (!mitigation) {
      throw notFound();
    }
    return { mitigation, crumb: mitigation.name };
  },
  component: MitigationDetail,
});
