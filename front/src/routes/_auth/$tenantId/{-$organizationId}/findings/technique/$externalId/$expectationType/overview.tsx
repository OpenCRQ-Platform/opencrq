import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CardField, InfoField, SectionCard, SourceStack } from '../../../../../../../../components/shared';
import { EmptyValue } from '../../../../../../../../components/ui/empty-value';
import { MitreDescription } from '../../../../../../../../features/mitre-attack/components/mitre-description';
import { useTRPC } from '../../../../../../../../lib';
import { formatDateTime, getEndpointPlatformLabel, getExpectationTypeLabel } from '../../../../../../../../utils';
import { Route as UniqueTechniqueFindingRoute } from './route';

const UniqueTechniqueFindingOverview = () => {
  const trpc = useTRPC();
  const { organizationId } = Route.useParams();
  const { finding: initialData } = UniqueTechniqueFindingRoute.useLoaderData();
  const { data: finding } = useQuery(trpc.findingScore.getUniqueTechniqueFinding.queryOptions(
    { externalId: initialData.externalId, expectationType: initialData.expectationType, organizationId: organizationId ?? null },
    { initialData },
  ));

  if (!finding) {
    return null;
  }

  const { externalId } = finding;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title={t`Information`}>
        <CardField title={t`MITRE technique`}>
          <p>
            <Link
              to="/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
              params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', techniqueExternalId: externalId })}
              className="text-primary underline-offset-4 hover:underline"
            >
              <span className="font-mono">{externalId}</span>
              {' '}
              {finding.name}
            </Link>
          </p>
        </CardField>

        <div className="grid grid-cols-2 gap-x-8">
          <CardField title={t`Tactics`}>
            {finding.tactics.length === 0
              ? <EmptyValue />
              : (
                <div className="flex flex-wrap gap-1.5">
                  {finding.tactics.map((tactic) => <Chip key={tactic.externalId} label={tactic.name} />)}
                </div>
              )}
          </CardField>
          <InfoField title={t`Expectation`} value={getExpectationTypeLabel(finding.expectationType)} />
        </div>

        <div className="grid grid-cols-2 gap-x-8">
          <CardField title={t`Platforms`}>
            {finding.platforms.length === 0
              ? <EmptyValue />
              : (
                <div className="flex flex-wrap gap-1.5">
                  {finding.platforms.map((platform) => <Chip key={platform} label={getEndpointPlatformLabel(platform)} />)}
                </div>
              )}
          </CardField>
          <CardField title={t`Sources`}>
            {finding.sources.length === 0 ? <EmptyValue /> : <SourceStack sources={finding.sources} />}
          </CardField>
        </div>

        <div className="grid grid-cols-2 gap-x-8">
          <InfoField title={t`First Seen`} value={finding.firstSeenAt === null ? undefined : formatDateTime(finding.firstSeenAt)} />
          <InfoField title={t`Last Seen`} value={finding.lastSeenAt === null ? undefined : formatDateTime(finding.lastSeenAt)} />
        </div>
      </SectionCard>

      <SectionCard title={t`Description`}>
        {finding.description
          ? <MitreDescription text={finding.description} />
          : <p className="text-muted-foreground"><Trans>No description in the catalogue.</Trans></p>}
      </SectionCard>
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: UniqueTechniqueFindingOverview,
});
