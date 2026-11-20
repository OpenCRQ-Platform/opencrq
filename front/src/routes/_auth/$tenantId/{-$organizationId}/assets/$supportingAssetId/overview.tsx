import { t } from '@lingui/core/macro';
import type { AssetManualAttribute } from '@app/module/client';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AssetRuleResolvedAttribute } from '../../../../../../features/supporting-assets';
import { CardField, DescriptionField, InfoField, MetricInfo, SectionCard } from '../../../../../../components/shared';
import {
  AssetCriticalityChip,
  AssetExposureChip,
  AssetPostureLifelineCard,
  AssetPropertyCards,
  AssetRelationsCard,
  AssetSourcesCard,
  AssetSourcesCardInfo,
  AssetTagChip,
  AssetTagsFieldInfo,
  getAssetFieldCopy,
  getAssetFieldTitle,
  hasPropertyCard,
  manualValuesInEffect,
  SetByUserMarker,
} from '../../../../../../features/supporting-assets';
import { useTRPC } from '../../../../../../lib';
import { EMPTY_VALUE, formatDate, getAssetCategoryLabel, getAssetSubcategoryLabel } from '../../../../../../utils';
import { Route as SupportingAssetRoute } from '../$supportingAssetId';

// Every attribute `updateSupportingAsset` can pin (`ASSET_MANUAL_ATTRIBUTE_VALUES`) that this page
// also shows as a rule-resolved field — `firstSeenAt`/`lastSeenAt` are resolved but never pinnable,
// so they are deliberately absent here.
const MANUAL_ATTRIBUTES: ReadonlyArray<AssetManualAttribute> = ['name', 'description', 'exposure', 'category', 'subcategory', 'criticality', 'url', 'linkedPerson'];

const isManualAttribute = (attribute: AssetRuleResolvedAttribute): attribute is AssetRuleResolvedAttribute & AssetManualAttribute =>
  (MANUAL_ATTRIBUTES as ReadonlyArray<string>).includes(attribute);

const SupportingAssetOverviewPage = () => {
  const trpc = useTRPC();
  const { tenantId } = Route.useParams();
  const { supportingAsset: initialData } = SupportingAssetRoute.useLoaderData();
  const { data: supportingAsset } = useQuery(trpc.supportingAssets.getSupportingAsset.queryOptions(
    { id: initialData.id },
    { initialData },
  ));
  const { data: postureHistory, isError: postureHistoryFailed } = useQuery(trpc.findingScore.getAssetPostureHistory.queryOptions(
    { supportingAssetId: initialData.id },
  ));

  if (!supportingAsset) {
    return null;
  }

  const manualValues = manualValuesInEffect(supportingAsset.manualValues, supportingAsset.subcategoryId);
  const fieldTitle = (attribute: AssetRuleResolvedAttribute): ReactNode => {
    const copy = getAssetFieldCopy(attribute, supportingAsset.sources, manualValues, supportingAsset.criticalityLift);
    const isManual = isManualAttribute(attribute)
      && manualValues.some((v) => v.attribute === attribute);
    return (
      <span className="flex items-center gap-1.5">
        {getAssetFieldTitle(attribute)}
        <MetricInfo title={getAssetFieldTitle(attribute)} what={copy.what} how={copy.how} caveat={copy.caveat ?? undefined} />
        <SetByUserMarker isManual={isManual} />
      </span>
    );
  };

  const { properties } = supportingAsset;
  // Under the posture card when nothing else follows it, so neither column ends far above the other.
  const sourcesBesidePosture = !hasPropertyCard(properties);
  const sourcesCard = (
    <SectionCard title={<span className="flex items-center gap-1.5">{t`Sources`}<AssetSourcesCardInfo /></span>}>
      <AssetSourcesCard sources={supportingAsset.sources} />
    </SectionCard>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <SectionCard title={t`Information`} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
          <DescriptionField className="col-span-2" title={fieldTitle('description')} value={supportingAsset.description} />
          <InfoField title={fieldTitle('name')} value={supportingAsset.name} />
          <InfoField title={t`Owner`} value={supportingAsset.owner?.name} />
          <CardField title={fieldTitle('exposure')}>
            <AssetExposureChip exposure={supportingAsset.exposure} categoryId={supportingAsset.categoryId} />
          </CardField>
          <InfoField title={fieldTitle('category')} value={getAssetCategoryLabel(supportingAsset.categoryId)} />
          <InfoField
            title={fieldTitle('subcategory')}
            value={supportingAsset.subcategoryId === null ? null : getAssetSubcategoryLabel(supportingAsset.subcategoryId)}
          />
          <CardField title={fieldTitle('criticality')}>
            <AssetCriticalityChip criticality={supportingAsset.criticality} />
          </CardField>
          {supportingAsset.url !== null && <InfoField title={fieldTitle('url')} value={supportingAsset.url} />}
          {supportingAsset.linkedPerson !== null && <InfoField title={fieldTitle('linkedPerson')} value={supportingAsset.linkedPerson} />}
          <InfoField title={fieldTitle('firstSeenAt')} value={supportingAsset.firstSeenAt ? formatDate(supportingAsset.firstSeenAt) : null} />
          <InfoField title={fieldTitle('lastSeenAt')} value={supportingAsset.lastSeenAt ? formatDate(supportingAsset.lastSeenAt) : null} />
          <CardField
            className="col-span-2"
            title={(
              <span className="flex items-center gap-1.5">
                {t`Tags`}
                <AssetTagsFieldInfo />
              </span>
            )}
          >
            {supportingAsset.tags.length === 0
              ? <p>{EMPTY_VALUE}</p>
              : (
                <div className="flex flex-wrap gap-2">
                  {supportingAsset.tags.map((tag) => <AssetTagChip key={tag.id} name={tag.name} color={tag.color} />)}
                </div>
              )}
          </CardField>
        </SectionCard>
        {!sourcesBesidePosture && sourcesCard}
      </div>

      <div className="flex flex-col gap-4">
        <AssetPostureLifelineCard
          tenantId={tenantId}
          supportingAssetId={supportingAsset.id}
          lines={postureHistory}
          isError={postureHistoryFailed}
        />
        <AssetPropertyCards properties={properties} manualProperties={supportingAsset.manualProperties} />
        {supportingAsset.relations.length > 0 && (
          <SectionCard title={t`Relations`}>
            <AssetRelationsCard relations={supportingAsset.relations} />
          </SectionCard>
        )}
        {sourcesBesidePosture && sourcesCard}
      </div>
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/assets/$supportingAssetId/overview')({
  loader: () => ({ crumb: t`Overview` }),
  component: SupportingAssetOverviewPage,
});
