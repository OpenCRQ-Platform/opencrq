import { SECURITY_NEED_CRITERIA } from '@app/module/client';
import type { SecurityNeedLevel } from '@app/module/client';
import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { CardField, InfoField, SectionCard } from '../../../../../../components/shared';
import { EmptyValue } from '../../../../../../components/ui/empty-value';
import { businessResourceName } from '../../../../../../features/business-value-categories';
import { SecurityNeedChip } from '../../../../../../features/primary-assets/components/security-need-chip';
import { formatDuration, securityCriterionLabel } from '../../../../../../features/primary-assets/primary-asset-fields-labels';
import { overallSecurityNeed } from '../../../../../../features/primary-assets/primary-asset-fields-utils';
import { useTRPC } from '../../../../../../lib';
import { Route as PrimaryAssetRoute } from '../$primaryAssetId';

const LevelValue: FunctionComponent<{ level: SecurityNeedLevel | null }> = ({ level }) => (
  level === null
    ? <p className="text-muted-foreground">{t`Not set`}</p>
    : <SecurityNeedChip level={level} />
);

const DurationValue: FunctionComponent<{ minutes: number | null }> = ({ minutes }) => (
  minutes === null
    ? <p className="text-muted-foreground">{t`Not set`}</p>
    : <p>{formatDuration(minutes)}</p>
);

const PrimaryAssetOverviewPage = () => {
  const trpc = useTRPC();
  const { primaryAsset: initialData } = PrimaryAssetRoute.useLoaderData();
  const { data: primaryAsset } = useQuery(trpc.primaryAssets.getPrimaryAsset.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!primaryAsset) {
    return null;
  }

  const overall = overallSecurityNeed(primaryAsset);

  return (
    <div className="grid grid-cols-2 gap-6 items-start">
      <SectionCard title={t`Asset detail`}>
        <CardField title={t`Description`}>
          <p className="whitespace-pre-wrap break-words">{primaryAsset.description ?? <EmptyValue />}</p>
        </CardField>
      </SectionCard>
      <SectionCard title={t`Information`}>
        <div className="grid grid-cols-2 gap-4">
          <InfoField title={t`Reference`} value={primaryAsset.reference} />
          <InfoField title={t`Business function`} value={primaryAsset.businessFunction} />
          <InfoField title={t`Owner`} value={primaryAsset.owner?.name} />
        </div>
        {primaryAsset.businessValueCategories.length > 0 && (
          <CardField title={t`Business resources`}>
            <div className="flex flex-wrap gap-2">
              {primaryAsset.businessValueCategories.map((category) => (
                <Chip key={category.id} label={businessResourceName(category)} />
              ))}
            </div>
          </CardField>
        )}
      </SectionCard>
      <SectionCard title={t`Security needs`}>
        <CardField title={t`Overall level`}>
          <LevelValue level={overall} />
        </CardField>
        <div className="grid grid-cols-4 gap-4">
          {SECURITY_NEED_CRITERIA.map((criterion) => (
            <CardField key={criterion} title={securityCriterionLabel(criterion)}>
              <LevelValue level={primaryAsset[criterion]} />
            </CardField>
          ))}
        </div>
      </SectionCard>
      <SectionCard title={t`Recovery objectives`}>
        <div className="grid grid-cols-3 gap-4">
          <CardField title={t`RTO`}><DurationValue minutes={primaryAsset.rtoMinutes} /></CardField>
          <CardField title={t`RPO`}><DurationValue minutes={primaryAsset.rpoMinutes} /></CardField>
          <CardField title={t`MTPD`}><DurationValue minutes={primaryAsset.mtpdMinutes} /></CardField>
        </div>
      </SectionCard>
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/primary-assets/$primaryAssetId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: PrimaryAssetOverviewPage,
});
