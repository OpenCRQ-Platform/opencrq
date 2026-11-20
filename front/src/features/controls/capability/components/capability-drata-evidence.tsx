import { Button, Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { CapabilityDetail, CapabilityRung } from '../types/capability';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { DebouncedSearchField, InfoTooltip, SectionCard, TooltipHint, TooltipHintProvider } from '../../../../components/shared';
import { DataPageLayout } from '../../../../components/ui/data-page-layout';
import { useTRPC } from '../../../../lib';
import { ControlStateBadge } from '../../../drata';
import { drataReachLabel } from '../ui/drata-reach-label';
import { filterDrataEvidence, readyCountOf } from '../utils/drata-evidence-utils';

const PAGE_SIZE = 5;

type DrataSupport = inferRouterOutputs<TRPCRouter>['drata']['getCapabilityDerivation']['supports'][number];
type DrataEvidenceRow = DrataSupport & { id: string };

const AttestedLevelsHeader = (): ReactElement => (
  <span className="flex items-center gap-1.5">
    {t`Attested levels`}
    {/* The header sorts on click: the tooltip's own click must not reach it. */}
    <span onClick={(event) => event.stopPropagation()}>
      <InfoTooltip label={t`About attested levels`} side="bottom">
        <Trans>The strength levels of this control that the Drata control attests: for L2 and L3, only what that level adds. Hover a level to read it.</Trans>
      </InfoTooltip>
    </span>
  </span>
);

const buildColumns = (rungs: ReadonlyArray<CapabilityRung>): Array<ColumnDefWithOptionsHeader<DrataEvidenceRow, unknown>> => [
  {
    id: 'code',
    accessorKey: 'code',
    header: t`Code`,
    size: 110,
    cell: ({ row }): ReactElement => <span className="font-mono">{row.original.code}</span>,
  },
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Control`,
    size: 400,
    cell: ({ row }): ReactElement => <span className="line-clamp-2">{row.original.name}</span>,
  },
  {
    id: 'levels',
    accessorKey: 'levels',
    header: (): ReactElement => <AttestedLevelsHeader />,
    size: 170,
    cell: ({ row }): ReactElement => (
      <TooltipHintProvider>
        <div className="flex gap-1">
          {row.original.levels.map((level) => {
            const label = rungs.find((rung) => rung.rung === level)?.label;
            return label === undefined
              ? <Chip key={level} label={level} />
              : (
                <TooltipHint key={level} hint={label}>
                  <span role="img" aria-label={`${level}: ${label}`}>
                    <Chip label={level} />
                  </span>
                </TooltipHint>
              );
          })}
        </div>
      </TooltipHintProvider>
    ),
  },
  {
    id: 'reach',
    accessorKey: 'reach',
    header: t`Reach`,
    size: 190,
    cell: ({ row }): ReactElement | null => {
      const { reach } = row.original;
      return reach === undefined ? null : <Chip label={drataReachLabel(reach)} />;
    },
  },
  {
    id: 'state',
    accessorKey: 'isReady',
    header: t`State`,
    size: 110,
    cell: ({ row }): ReactElement => <ControlStateBadge isReady={row.original.isReady} />,
  },
];

/**
 * The Drata controls of the tenant's mirror mapped to a control. Renders nothing for a tenant whose
 * mirror holds no Drata control.
 */
export const CapabilityDrataEvidence: FunctionComponent<{ capability: CapabilityDetail }> = ({ capability }) => {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [notReadyOnly, setNotReadyOnly] = useState(false);
  const { data, isLoading } = useQuery(trpc.drata.getCapabilityDerivation.queryOptions({ capabilityId: capability.id }));
  const supports = data?.supports ?? [];
  const readyCount = readyCountOf(supports);
  const supportCount = supports.length;

  if (data?.hasMirror !== true) {
    return null;
  }

  const rows = filterDrataEvidence(supports, { search, notReadyOnly }).map((control) => ({ ...control, id: control.code }));
  const title = supportCount === 0
    ? t`Drata evidence`
    : t({
      message: plural(readyCount, {
        one: `Drata evidence · # ready of ${supportCount}`,
        other: `Drata evidence · # ready of ${supportCount}`,
      }),
    });

  return (
    <SectionCard title={title}>
      {data.derived === null && supportCount > 0 && (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>None of these Drata controls attests this control's base level, L1, so Drata gives it no level.</Trans>
        </p>
      )}
      {supportCount === 0
        ? (
          <p className="txt-sub-content text-muted-foreground">
            <Trans>No Drata control of your account is mapped to this control.</Trans>
          </p>
        )
        : (
          <DataPageLayout
            data={rows}
            columns={buildColumns(capability.rungs)}
            isLoading={isLoading}
            storageKey="capability.drataEvidence"
            initialPageSize={PAGE_SIZE}
            leftHeaderContent={(
              <>
                <DebouncedSearchField
                  placeholder={t`Search controls...`}
                  value={search}
                  onCommit={setSearch}
                  clearLabel={t`Clear search`}
                  className="w-80"
                />
                <Button
                  priority={notReadyOnly ? 'primary' : 'secondary'}
                  aria-pressed={notReadyOnly}
                  onClick={() => setNotReadyOnly(!notReadyOnly)}
                >
                  <Trans>Not ready</Trans>
                </Button>
              </>
            )}
          />
        )}
    </SectionCard>
  );
};
