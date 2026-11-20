import { t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import type { SupportingAssetExposure } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import type { AttackClaimRow, AttackCoverage } from '../attack-groups-utils';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { CrqIndicatorsSettingsLink } from '../../crq-indicator-settings';
import { createTechniqueColumn, useTechniqueRowNavigate } from '../../mitre-attack/components';
import { exposureLabel } from '../../finding-score';
import { getAssetCategoryLabel } from '../../../utils';
import { attackRowKey, exposureReadingOf, holdsOnEveryAsset } from '../attack-groups-utils';
import { MonoChip } from './mono-chip';

// The row itself opens the technique, so a click on a weakness must not reach it.
const WeaknessLinks: FunctionComponent<{ cwe: ReadonlyArray<string> }> = ({ cwe }) => (
  <span className="inline-flex flex-wrap gap-1">
    {cwe.map((cweId) => (
      <Link
        key={cweId}
        to="/$tenantId/{-$organizationId}/settings/taxonomies/cwe/$cweId"
        params={(prev) => ({ ...prev, tenantId: prev.tenantId!, cweId })}
        onClick={(event) => event.stopPropagation()}
      >
        <MonoChip>{cweId}</MonoChip>
      </Link>
    ))}
  </span>
);

const VectorReading: FunctionComponent<{ vector: ReactNode, exposures: ReadonlyArray<SupportingAssetExposure> }> = ({ vector, exposures }) => {
  switch (exposureReadingOf(exposures)) {
    case 'all': return <Trans>Read from the CVSS vector {vector} on the assets of every exposure.</Trans>;
    case 'internetFacing': return <Trans>Read from the CVSS vector {vector} on the internet-facing assets.</Trans>;
    case 'internal': return <Trans>Read from the CVSS vector {vector} on the internal assets.</Trans>;
    case 'unknown': return <Trans>Read from the CVSS vector {vector} on the assets of unknown exposure.</Trans>;
    case 'internetFacingAndUnknown': return <Trans>Read from the CVSS vector {vector} on the internet-facing assets and those of unknown exposure.</Trans>;
    case 'internalAndUnknown': return <Trans>Read from the CVSS vector {vector} on the internal assets and those of unknown exposure.</Trans>;
    case 'internetFacingAndInternal': return <Trans>Read from the CVSS vector {vector} on the internet-facing and internal assets.</Trans>;
  }
};

const Justification: FunctionComponent<{
  justification: AttackClaimRow['justification'],
  /** The exposure a finding's asset declares; the rule's reading carries the one it was counted as. */
  assetExposure?: SupportingAssetExposure,
  /** Set on a unique finding, whose row gathers the findings of several assets. */
  exposures?: ReadonlyArray<SupportingAssetExposure>,
}> = ({ justification, assetExposure, exposures }) => {
  switch (justification.kind) {
    case 'supplied':
      return exposures === undefined
        ? <Trans>Stated by the connector that reported this finding.</Trans>
        : <Trans>Stated by a connector that reported a finding of this CVE.</Trans>;
    case 'curated':
      return <Trans>Documented for this CVE in the curated CVE-to-ATT&CK corpus.</Trans>;
    case 'weakness':
      return <Trans>Made possible by the weakness class of this CVE, <WeaknessLinks cwe={justification.cwe} />.</Trans>;
    case 'topology': {
      const { reading } = justification;
      if (reading.kind === 'weakness') {
        const weakness = reading.cwe;
        return <Trans>The weakness <MonoChip>{weakness}</MonoChip> is itself the way in: it hands over a valid account.</Trans>;
      }
      // eslint-disable-next-line lingui/no-unlocalized-strings -- CVSS metric notation, not copy
      const vector = `AV:${reading.attackVector}/PR:${reading.privilegesRequired}/UI:${reading.userInteraction}`;
      if (exposures !== undefined) {
        return <VectorReading vector={<MonoChip>{vector}</MonoChip>} exposures={exposures} />;
      }
      const exposure = exposureLabel(reading.exposure);
      return assetExposure === 'unknown'
        ? (
          <Trans>
            Read from the CVSS vector <MonoChip>{vector}</MonoChip> on an asset of unknown exposure, counted as {exposure} by the{' '}
            <CrqIndicatorsSettingsLink onClick={(event) => event.stopPropagation()}>
              CRQ indicators
            </CrqIndicatorsSettingsLink>.
          </Trans>
        )
        : <Trans>Read from the CVSS vector <MonoChip>{vector}</MonoChip> on an asset whose exposure is {exposure}.</Trans>;
    }
  }
};

/** The row opens the technique, so the link to the assets must not reach it. */
const AssetsCell: FunctionComponent<{ row: AttackClaimRow, coverage: AttackCoverage }> = ({ row, coverage }) => {
  const held = coverage.byRow.get(attackRowKey(row));
  if (held === undefined) {
    return null;
  }
  const { cveId, totalAssetCount } = coverage;
  const { assetCount } = held;
  const technique = row.externalId;
  const share = <Trans>{assetCount} of {totalAssetCount}</Trans>;
  return (
    <span className="flex flex-col gap-0.5">
      {holdsOnEveryAsset(held, totalAssetCount)
        ? <span><Trans>All</Trans></span>
        : assetCount === 0
          ? <span>{share}</span>
          : (
            <Link
              to="/$tenantId/{-$organizationId}/findings/cve/$cveId/assets"
              params={(prev) => ({ ...prev, tenantId: prev.tenantId!, cveId })}
              search={{ technique }}
              className="text-primary underline-offset-4 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {share}
            </Link>
          )}
      {held.setAside.map(({ categoryId, assetCount: setAsideCount }) => {
        const family = getAssetCategoryLabel(categoryId);
        return (
          <span key={categoryId} className="text-muted-foreground">
            <Plural value={setAsideCount} one={`set aside on # ${family} asset`} other={`set aside on # ${family} assets`} />
          </span>
        );
      })}
    </span>
  );
};

type AttackTechniqueRow = AttackClaimRow & { id: string, tactics: Array<string> };

interface AttackTechniquesTableProps {
  rows: Array<AttackClaimRow>,
  tactics: Map<string, Array<string>>,
  storageKey: string,
  exposure?: SupportingAssetExposure,
  coverage?: AttackCoverage,
}

/** Unsorted: the rows of a group come in the order the attack runs them. */
export const AttackTechniquesTable: FunctionComponent<AttackTechniquesTableProps> = ({ rows, tactics, storageKey, exposure, coverage }) => {
  const onClickRow = useTechniqueRowNavigate<AttackTechniqueRow>();
  const data: Array<AttackTechniqueRow> = rows.map((row) => ({
    ...row,
    id: `${row.mitreTechniqueId}-${row.group}`,
    tactics: tactics.get(row.mitreTechniqueId) ?? [],
  }));

  const assetsColumn: Array<ColumnDefWithOptionsHeader<AttackTechniqueRow, unknown>> = coverage === undefined ? [] : [{
    id: 'assets',
    accessorFn: (row) => coverage.byRow.get(attackRowKey(row))?.assetCount ?? 0,
    header: t`Assets`,
    size: 200,
    cell: ({ row }): ReactElement => <AssetsCell row={row.original} coverage={coverage} />,
  }];

  const columns: Array<ColumnDefWithOptionsHeader<AttackTechniqueRow, unknown>> = [
    { ...createTechniqueColumn<AttackTechniqueRow>(), size: 320 },
    {
      id: 'tactics',
      accessorFn: (row) => row.tactics.join(' · '),
      header: t`Tactics`,
      size: 200,
      cell: ({ row }): ReactElement => (
        <span className="text-muted-foreground">{row.original.tactics.join(' · ')}</span>
      ),
    },
    ...assetsColumn,
    {
      id: 'justification',
      accessorFn: (row) => row.justification.kind,
      header: t`Why`,
      size: 420,
      cell: ({ row }): ReactElement => (
        <span className="block whitespace-normal leading-normal text-muted-foreground">
          <Justification
            justification={row.original.justification}
            assetExposure={exposure}
            exposures={coverage?.byRow.get(attackRowKey(row.original))?.exposures}
          />
        </span>
      ),
    },
  ];

  return (
    <DataPageLayout
      data={data}
      columns={columns}
      storageKey={storageKey}
      enableSorting={false}
      hideToolbar
      onClickRow={onClickRow}
    />
  );
};
