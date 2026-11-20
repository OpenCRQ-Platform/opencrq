import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../../../../../../../lib';
import { CardField, InfoField, SectionCard } from '../../../../../../../../../components/shared';
import { EmptyValue } from '../../../../../../../../../components/ui/empty-value';
import { MitreDescription } from '../../../../../../../../../features/mitre-attack/components/mitre-description';
import { RelatedMitigationsTable } from '../../../../../../../../../features/mitre-attack/components/related-mitigations-table';
import { RelatedTacticsTable } from '../../../../../../../../../features/mitre-attack/components/related-tactics-table';
import { RelatedTechniquesTable } from '../../../../../../../../../features/mitre-attack/components/related-techniques-table';
import { Route as TechniqueRoute } from './route';

const TechniqueOverview = () => {
  const trpc = useTRPC();
  const { technique: initialData } = TechniqueRoute.useLoaderData();
  const { data: technique } = useQuery(trpc.mitreAttack.getTechniqueByExternalId.queryOptions(
    { externalId: initialData.externalId },
    { initialData },
  ));

  if (!technique) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-6">
        <SectionCard title={t`Details`} cardClassName="flex-1">
          <div className="flex flex-col gap-6">
            <InfoField title={t`External ID`} value={technique.externalId} />
            <InfoField title={t`Type`} value={technique.isSubtechnique ? t`Sub-technique` : t`Technique`} />
            <CardField title={t`Reference`}>
              {technique.url
                ? <a href={technique.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{technique.url}</a>
                : <EmptyValue />}
            </CardField>
          </div>
        </SectionCard>

        <SectionCard title={t`Description`} className="col-span-2" cardClassName="flex-1">
          {technique.description
            ? <MitreDescription text={technique.description} />
            : <EmptyValue />}
        </SectionCard>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <SectionCard title={t`Tactics`} cardClassName="flex-1">
          <RelatedTacticsTable
            tactics={technique.tactics}
            storageKey="technique.tactics"
            compact
            emptyState={(
              <p className="txt-sub-content text-default-secondary">
                <Trans>This technique belongs to no tactic.</Trans>
              </p>
            )}
          />
        </SectionCard>

        <SectionCard title={t`Sub-techniques`} cardClassName="flex-1">
          <RelatedTechniquesTable
            techniques={technique.subTechniques}
            storageKey="technique.subTechniques"
            compact
            emptyState={(
              <p className="txt-sub-content text-default-secondary">
                <Trans>This technique has no sub-technique.</Trans>
              </p>
            )}
          />
        </SectionCard>

        <SectionCard title={t`Mitigations`} cardClassName="flex-1">
          <RelatedMitigationsTable
            mitigations={technique.mitigations}
            storageKey="technique.mitigations"
            compact
            emptyState={(
              <p className="txt-sub-content text-default-secondary">
                <Trans>MITRE ATT&CK recommends no mitigation for this technique.</Trans>
              </p>
            )}
          />
        </SectionCard>
      </div>
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: TechniqueOverview,
});
