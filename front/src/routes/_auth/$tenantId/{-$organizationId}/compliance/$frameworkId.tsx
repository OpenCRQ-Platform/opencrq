import { Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, linkOptions, notFound, Outlet } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { scopePath } from '../../../../../components/layout/scope-path-utils';
import { CardField, DetailPageLayout, InfoField, RouteTabs, SectionCard } from '../../../../../components/shared';
import { EmptyValue } from '../../../../../components/ui/empty-value';
import { NOT_READY_SEVERITY, ReadinessBar, READY_SEVERITY, useFrameworkReadiness } from '../../../../../features/drata';
import { trpcClient, useTRPC } from '../../../../../lib';
import { formatDateTime } from '../../../../../utils/date-utils';
import { formatPointsAsPercent } from '../../../../../utils/format-number';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/$frameworkId')({
  loader: async ({ params }) => {
    const framework = await trpcClient.drata.getFramework.query({ id: params.frameworkId });
    if (!framework) {
      throw notFound();
    }
    // The assessments list holds this framework but sits on a sibling path, not a parent one.
    const ancestorCrumbs = [{ label: t`Assessments`, to: scopePath(params.tenantId, params.organizationId, 'compliance/assessments') }];
    return { framework, ancestorCrumbs, crumb: framework.name };
  },
  component: function DrataFrameworkLayout() {
    const trpc = useTRPC();
    const { framework: initialData } = Route.useLoaderData();
    const { data: framework } = useQuery(trpc.drata.getFramework.queryOptions(
      { id: initialData.id },
      { initialData },
    ));
    const { data: connectorsStatus } = useQuery(trpc.integrations.getConnectorsStatus.queryOptions());
    const readiness = useFrameworkReadiness(initialData.id);
    if (!framework) {
      throw notFound();
    }

    const drataUrl = connectorsStatus?.drata?.url ?? null;
    const readyCount = readiness?.readyInScope ?? 0;
    const inScopeCount = readiness?.inScope ?? 0;

    const tabs = [
      {
        key: 'requirements',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/compliance/$frameworkId', to: 'requirements' }),
        label: t`Requirements`,
      },
      {
        key: 'controls',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/compliance/$frameworkId', to: 'controls' }),
        label: t`Controls`,
      },
    ];

    return (
      <DetailPageLayout
        title={framework.name}
        actions={(
          <div className="flex items-center gap-2">
            <Chip label={framework.tag} />
            {drataUrl !== null && (
              <a
                href={drataUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 underline txt-sub-content"
              >
                <ExternalLink className="size-4 shrink-0" />
                <Trans>Open in Drata</Trans>
              </a>
            )}
          </div>
        )}
      >
        <div className="grid grid-cols-2 gap-6">
          <SectionCard title={<Trans>Readiness</Trans>}>
            <div className="flex items-baseline gap-2">
              <span className="font-bold">
                {readiness?.percent == null ? <EmptyValue /> : formatPointsAsPercent(readiness.percent, 0)}
              </span>
              {readiness && readiness.percent !== null && (
                <span className="txt-sub-content text-muted-foreground">
                  {t({
                    message: plural(inScopeCount, {
                      one: `${readyCount} of # in-scope requirement ready`,
                      other: `${readyCount} of # in-scope requirements ready`,
                    }),
                  })}
                </span>
              )}
            </div>
            <ReadinessBar
              ready={readiness?.readyInScope ?? 0}
              notReady={readiness?.notReadyInScope ?? 0}
              outOfScope={readiness?.outOfScope ?? 0}
            />
          </SectionCard>
          <SectionCard title={<Trans>As reported by Drata</Trans>}>
            <div className="grid grid-cols-2 gap-4">
              <CardField title={t`Status`}>
                {framework.isReady
                  ? <Chip severity={READY_SEVERITY} label={t`Ready`} />
                  : <Chip severity={NOT_READY_SEVERITY} label={t`Not ready`} />}
              </CardField>
              <InfoField title={t`Slug`} value={framework.slug} />
              <InfoField title={t`In-scope requirements`} value={String(framework.numInScopeRequirements)} />
              <InfoField title={t`Ready in-scope requirements`} value={String(framework.numReadyInScopeRequirements)} />
              <InfoField title={t`In-scope controls`} value={String(framework.numInScopeControls)} />
              <InfoField title={t`Last synced`} value={formatDateTime(framework.lastReportedAt)} />
            </div>
          </SectionCard>
        </div>
        <RouteTabs tabs={tabs} />
        <Outlet />
      </DetailPageLayout>
    );
  },
});
