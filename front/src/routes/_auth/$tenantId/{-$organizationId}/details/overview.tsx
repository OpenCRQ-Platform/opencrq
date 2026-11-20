import { Button, Chip, Text } from '@filigran/design-system';
import { createFileRoute } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { CardField, InfoField, SectionCard } from '../../../../../components/shared';
import { ExpandableText } from '../../../../../components/ui/expandable-text';
import { useOpenScopeDrawer } from '../../../../../features/organizations';
import { ScopeRiskToleranceCard } from '../../../../../features/risk-tolerance';
import { useTRPC } from '../../../../../lib';
import { formatNumber, formatRevenueBand } from '../../../../../utils';
import { EMPTY_VALUE } from '../../../../../utils/empty-value';
import { Route as OrganizationScopeRoute } from '../route';

const formatEmployeeCount = (count: number | null | undefined): string => {
  if (count === null || count === undefined) {
    return EMPTY_VALUE;
  }
  return formatNumber(count);
};

const formatContainmentTime = (
  min: number | null | undefined,
  likely: number | null | undefined,
  max: number | null | undefined,
): string => {
  if (min === null || min === undefined || likely === null || likely === undefined || max === null || max === undefined) {
    return EMPTY_VALUE;
  }
  return t`${min} / ${likely} / ${max} h`;
};

const OrganizationDetailsOverview: FunctionComponent = () => {
  const trpc = useTRPC();
  const openScopeDrawer = useOpenScopeDrawer();
  const { organization: scopedOrganization } = OrganizationScopeRoute.useLoaderData();

  const { data: organization } = useQuery(trpc.organizations.getOrganization.queryOptions(
    { id: scopedOrganization?.id ?? '' },
    { initialData: scopedOrganization, enabled: scopedOrganization !== undefined },
  ));

  if (!organization) {
    return null;
  }

  const isClosed = organization.estateMode === 'closed';
  const isEmptyEstate = organization.noMappedAsset;

  return (
    <div className="flex flex-col gap-6">
      {isEmptyEstate && (
        <div className="flex items-center justify-between gap-4 rounded-l-sm border-l-2 border-l-orange bg-card p-4">
          <Text as="p" variant="content-compact">
            <Trans>This scope has no asset: nothing is measured over it until one is mapped.</Trans>
          </Text>
          <Button priority="secondary" onClick={() => openScopeDrawer(organization.id, 'manage-assets')}><Trans>Manage assets</Trans></Button>
        </div>
      )}
      <div className="grid grid-cols-2 items-start gap-6">
        <div className="flex flex-col gap-6">
          <SectionCard title={t`Risk scope information`}>
            <div className="grid grid-cols-2 gap-6">
              <InfoField title={t`Legal Entity Name`} value={organization.legalEntityName} />
              <InfoField title={t`Sector`} value={organization.sector?.name} />
              <InfoField title={t`Country`} value={organization.country?.name} />
              <InfoField title={t`Domain`} value={organization.domain} />
              <InfoField title={t`Annual Revenue`} value={formatRevenueBand(organization.revenueBand)} />
              <InfoField title={t`Employee Count`} value={formatEmployeeCount(organization.employeeCount)} />
              <InfoField
                title={t`Containment time (MTTC)`}
                value={formatContainmentTime(organization.reactionTimeMin, organization.reactionTimeLikely, organization.reactionTimeMax)}
              />
            </div>
          </SectionCard>
          {organization.description && (
            <SectionCard title={t`Description`}>
              <ExpandableText text={organization.description} />
            </SectionCard>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <SectionCard title={t`The scope's estate`}>
            <div className="flex flex-col gap-4">
              <CardField title={t`Measured over`}>
                <Chip label={isClosed ? t`Mapped assets only` : t`Whole estate`} />
              </CardField>
              {isClosed && (
                <CardField title={t`Mapped assets`}>
                  <Text as="p" variant="content-base">
                    {plural(organization.mappedAssetCount, { one: '# asset', other: '# assets' })}
                  </Text>
                </CardField>
              )}
              <div>
                <Button priority="secondary" onClick={() => openScopeDrawer(organization.id, 'manage-assets')}>
                  {isClosed ? t`Manage assets` : t`Map the assets`}
                </Button>
              </div>
            </div>
          </SectionCard>
          <ScopeRiskToleranceCard organizationId={organization.id} />
        </div>
      </div>
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: OrganizationDetailsOverview,
});
