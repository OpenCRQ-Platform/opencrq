import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { AssetCategory, AssetCriticality, AssetRelationKind, AssetRelationSource, AssetSubcategory } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { AssetRelationDirection } from '../asset-relations-utils';
import { CardField } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { useTenant } from '../../../providers/tenant-provider';
import { formatDate, getAssetCategoryLabel, getAssetSubcategoryLabel } from '../../../utils';
import { assetRelationGroupLabel, assetRelationSourceLabel } from '../asset-relation-labels';
import { groupAssetRelations } from '../asset-relations-utils';
import { AssetCriticalityChip } from './asset-chips';

export interface AssetRelationEntry {
  id: string,
  kind: AssetRelationKind,
  direction: AssetRelationDirection,
  source: AssetRelationSource,
  lastReportedAt: Date | string,
  otherAsset: {
    id: string,
    name: string | null,
    derivedName: string | null,
    categoryId: AssetCategory,
    subcategoryId: AssetSubcategory | null,
    criticality: AssetCriticality,
  },
}

const RelationRow: FunctionComponent<{ relation: AssetRelationEntry, isLast: boolean }> = ({ relation, isLast }) => {
  const { tenantId } = useTenant();
  const { otherAsset } = relation;
  const family = [getAssetCategoryLabel(otherAsset.categoryId), otherAsset.subcategoryId === null ? null : getAssetSubcategoryLabel(otherAsset.subcategoryId)]
    .filter((label): label is string => label !== null)
    .join(' · ');
  const source = assetRelationSourceLabel(relation.source);
  const lastSeen = formatDate(relation.lastReportedAt);

  return (
    <div
      className="flex items-center justify-between gap-4 py-3"
      style={{ borderBottom: isLast ? undefined : '1px solid var(--fds-border-elevation-subtle-soft)' }}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/$tenantId/{-$organizationId}/assets/$supportingAssetId"
          params={{ tenantId, supportingAssetId: otherAsset.id }}
          className="txt-default break-words font-medium text-primary underline-offset-4 hover:underline"
        >
          <AssetName name={otherAsset.name} derivedName={otherAsset.derivedName} />
        </Link>
        <span className="txt-sub-content text-muted-foreground">{family}</span>
        <span className="txt-sub-content text-muted-foreground"><Trans>{source}, last seen {lastSeen}</Trans></span>
      </span>
      <span className="shrink-0">
        <AssetCriticalityChip criticality={otherAsset.criticality} />
      </span>
    </div>
  );
};

export const AssetRelationsCard: FunctionComponent<{ relations: ReadonlyArray<AssetRelationEntry> }> = ({ relations }) => (
  <div className="flex flex-col gap-5">
    {groupAssetRelations(relations).map((group) => (
      <CardField key={`${group.kind}:${group.direction}`} title={assetRelationGroupLabel(group.kind, group.direction)}>
        <div className="flex flex-col">
          {group.relations.map((relation, index) => (
            <RelationRow key={relation.id} relation={relation} isLast={index === group.relations.length - 1} />
          ))}
        </div>
      </CardField>
    ))}
  </div>
);
