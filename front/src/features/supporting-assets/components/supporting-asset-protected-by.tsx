import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useParams } from '@tanstack/react-router';
import type { AssetCategory } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { ProtectingControlRow } from '../protected-by-utils';
import { ControlIdPill } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { splitProtectingControls } from '../protected-by-utils';
import { CoverageCell, EffectivenessCell, StrengthCell, TestedOnAssetCell } from './protecting-control-cells';
import { ProtectingControlDrawer } from './protecting-control-drawer';

const protectingControlColumns = (outsideCategory: boolean): Array<ColumnDefWithOptionsHeader<ProtectingControlRow, unknown>> => [
  {
    id: 'externalId',
    accessorKey: 'externalId',
    header: t`ID`,
    size: 100,
    cell: ({ row }) => <ControlIdPill externalId={row.original.externalId} />,
  },
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Control`,
    size: 340,
    cell: ({ row }) => <p className="font-medium">{row.original.name}</p>,
  },
  {
    id: 'strength',
    header: t`Strength`,
    size: 170,
    cell: ({ row }) => <StrengthCell control={row.original} />,
  },
  {
    id: 'coverage',
    header: t`Coverage`,
    size: 170,
    cell: ({ row }) => <CoverageCell control={row.original} />,
  },
  {
    id: 'effectiveness',
    header: t`Effectiveness`,
    size: 160,
    cell: ({ row }) => <EffectivenessCell control={row.original} />,
  },
  {
    id: 'techniques',
    header: t`TTP`,
    size: 80,
    cell: ({ row }) => (
      <span className="tabular-nums">{outsideCategory ? EMPTY_VALUE : row.original.assetTechniqueCount}</span>
    ),
  },
  {
    id: 'testedHere',
    header: t`Tested on this asset`,
    size: 280,
    cell: ({ row }) => <TestedOnAssetCell control={row.original} namesTechniques={outsideCategory} />,
  },
];

interface SupportingAssetProtectedByProps {
  tenantId: string,
  supportingAssetId: string,
  supportingAssetName: string,
  categoryId: AssetCategory,
}

export const SupportingAssetProtectedBy: FunctionComponent<SupportingAssetProtectedByProps> = ({
  tenantId,
  supportingAssetId,
  supportingAssetName,
  categoryId,
}) => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const [openControlId, setOpenControlId] = useState<string | null>(null);
  const { data, isLoading } = useQuery(trpc.supportingAssets.getProtectingControls.queryOptions({
    supportingAssetId,
    organizationId: organizationId ?? null,
  }));
  const { data: organizations } = useQuery(trpc.organizations.getOrganizations.queryOptions());

  if (data?.inScope === false) {
    const scopeName = organizations?.find((organization) => organization.id === organizationId)?.name ?? '';
    return (
      <p className="text-muted-foreground">
        <Trans>{supportingAssetName} is not part of the risk scope {scopeName}.</Trans>
      </p>
    );
  }

  const { protecting, testedOutside } = splitProtectingControls(data?.controls ?? []);
  const openControl = (data?.controls ?? []).find((control) => control.capabilityId === openControlId) ?? null;
  const category = getAssetCategoryLabel(categoryId);

  return (
    <div className="flex flex-col gap-6">
      <DataPageLayout
        data={protecting}
        columns={protectingControlColumns(false)}
        storageKey="supporting-asset-protected-by"
        isLoading={isLoading}
        enableSorting={false}
        onClickRow={({ original }) => setOpenControlId(original.capabilityId)}
      />
      {testedOutside.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="txt-container-title text-muted-foreground">
            <Trans>Tested on this asset, outside the {category} category</Trans>
          </span>
          <DataPageLayout
            data={testedOutside}
            columns={protectingControlColumns(true)}
            storageKey="supporting-asset-protected-by-outside"
            enableSorting={false}
            hideToolbar
            onClickRow={({ original }) => setOpenControlId(original.capabilityId)}
          />
        </div>
      )}
      <ProtectingControlDrawer
        control={openControl}
        tenantId={tenantId}
        scopeSelected={organizationId !== undefined}
        onClose={() => setOpenControlId(null)}
      />
    </div>
  );
};
