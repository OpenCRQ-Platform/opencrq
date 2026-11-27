import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link, linkOptions, notFound, Outlet, redirect } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { EntityUnavailable } from '../../../../../../../../../components/layout';
import { DetailPageLayout, RouteTabs } from '../../../../../../../../../components/shared';
import { canonicalExternalIdHref } from '../../../../../../../../../features/mitre-attack/external-id-path-utils';
import { trpcClient } from '../../../../../../../../../lib';

const TechniqueNotFound = () => (
  <EntityUnavailable
    title={t`Technique unavailable`}
    description={t`This technique has been deleted or is no longer accessible.`}
    listLabel={t`See all techniques`}
    listLink={linkOptions({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId', to: '..' })}
  />
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId')({
  beforeLoad: ({ params, location }) => {
    const href = canonicalExternalIdHref(location, params.techniqueExternalId);
    if (href !== null) {
      throw redirect({ href, replace: true });
    }
  },
  loader: async ({ params }) => {
    const technique = await trpcClient.mitreAttack.getTechniqueByExternalId.query({ externalId: params.techniqueExternalId });
    if (!technique) {
      throw notFound();
    }
    return { technique, crumb: technique.name };
  },
  notFoundComponent: TechniqueNotFound,
  component: function TechniqueLayout() {
    const { technique } = Route.useLoaderData();

    const tabs = [
      {
        key: 'overview',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId', to: 'overview' }),
        label: t`Overview`,
      },
      {
        key: 'coverage',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId', to: 'coverage' }),
        label: t`Coverage`,
      },
      {
        key: 'assets',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId', to: 'assets' }),
        label: t`Assets`,
      },
    ];

    return (
      <DetailPageLayout title={technique.name}>
        {technique.revoked && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="txt-body2 text-destructive">
              {technique.replacedByTechniqueExternalId
                ? (
                  <Trans>
                    This technique has been revoked by MITRE ATT&CK and is no longer actively maintained.
                    {' '}
                    <Link
                      from="/$tenantId/{-$organizationId}"
                      to="settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
                      params={{ techniqueExternalId: technique.replacedByTechniqueExternalId }}
                      className="font-medium underline underline-offset-2"
                    >
                      View the replacement technique.
                    </Link>
                  </Trans>
                )
                : (
                  <Trans>This technique has been deprecated by MITRE ATT&CK and is no longer actively maintained.</Trans>
                )}
            </p>
          </div>
        )}
        <RouteTabs tabs={tabs} />
        <Outlet />
      </DetailPageLayout>
    );
  },
});
