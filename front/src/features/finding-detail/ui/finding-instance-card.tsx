import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AssetCategory, DismissalReasonCode, DismissalType, EvidenceHistoryOrigin } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import type { AssetNameParts } from '../../../utils/asset-name-utils';
import type { VulnerableSoftwareVersion } from '../vulnerable-software-utils';
import { MetricInfo, SourceStack } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { dismissalReasonLabel } from '../dismissal-vocabulary';
import { groupVulnerableSoftware } from '../vulnerable-software-utils';
import { formatDate, getAssetCategoryLabel } from '../../../utils';
import { DossierCard } from './dossier-card';
import { DossierField, DossierFieldGrid } from './dossier-field';
import { EvidenceStateChip } from './finding-chips';
import { MonoChip } from './mono-chip';

interface FindingInstanceCardProps {
  tenantId: string,
  supportingAssetId: string,
  assetName: AssetNameParts,
  assetCategoryId: AssetCategory,
  software: Array<VulnerableSoftwareVersion>,
  sources: Array<string>,
  reportedBy: string | null,
  /** When the finding was first recorded on the asset, which no later state change moves. */
  firstSeen: Date | string | null,
  /** When the source last spoke about it; null on a finding no connector reports, never a decision. */
  lastSeen: Date | string | null,
  state: 'applicable' | 'dismissed',
  /** What wrote the latest history row, null on a finding that has none. */
  stateOrigin: EvidenceHistoryOrigin | null,
  /** The type and code a person filed the decision under; both null while it is applicable. */
  dismissalType: DismissalType | null,
  dismissalReasonCode: DismissalReasonCode | null,
  stateDuration: string | null,
  className?: string,
}

const VulnerableSoftwareField: FunctionComponent<{ software: Array<VulnerableSoftwareVersion> }> = ({ software }) => {
  const products = groupVulnerableSoftware(software);
  if (products.length === 0) {
    return null;
  }
  return (
    <DossierField label={t`Installed vulnerable software`} className={software.length > 1 ? '[grid-column:1/-1]' : undefined}>
      <span className="flex flex-col gap-2">
        {products.map((product) => (
          <span key={`${product.vendor ?? ''}:${product.name}`} className="flex flex-wrap items-center gap-1.5">
            {product.vendor !== null && <span className="text-default-secondary">{product.vendor}</span>}
            <span>{product.name}</span>
            {product.versions.map((version) => <MonoChip key={version}>{version}</MonoChip>)}
          </span>
        ))}
      </span>
    </DossierField>
  );
};

/** The finding as it stands on this one asset, as opposed to the flaw the record above describes. */
export const FindingInstanceCard: FunctionComponent<FindingInstanceCardProps> = ({
  tenantId,
  supportingAssetId,
  assetName,
  assetCategoryId,
  software,
  sources,
  reportedBy,
  firstSeen,
  lastSeen,
  state,
  stateOrigin,
  dismissalType,
  dismissalReasonCode,
  stateDuration,
  className,
}) => (
  <DossierCard label={t`Asset`} className={className}>
    <DossierFieldGrid>
      <DossierField label={t`Asset`}>
        <Link
          to="/$tenantId/{-$organizationId}/assets/$supportingAssetId/overview"
          params={{ tenantId, supportingAssetId }}
          className="truncate text-primary underline-offset-4 hover:underline"
        >
          <AssetName name={assetName.name} derivedName={assetName.derivedName} />
        </Link>
      </DossierField>
      <DossierField label={t`Asset type`}>
        <span>{getAssetCategoryLabel(assetCategoryId)}</span>
      </DossierField>
      <VulnerableSoftwareField software={software} />
      <DossierField
        label={t`Source`}
        info={(
          <MetricInfo
            title={t`Source`}
            what={t`Every connector currently reporting this finding.`}
            how={t`One entry per connector with an observation on this finding.`}
          />
        )}
      >
        <SourceStack sources={sources} />
      </DossierField>
      <DossierField label={t`Reported by`}>
        {reportedBy === null
          ? <span className="text-default-secondary"><Trans>Automatic control</Trans></span>
          : <span>{reportedBy}</span>}
      </DossierField>
      <DossierField
        label={t`First seen`}
        info={(
          <MetricInfo
            title={t`First seen`}
            what={t`When the finding was first recorded on this asset.`}
            how={t`The oldest first observation, across every source reporting it.`}
          />
        )}
      >
        {firstSeen === null
          ? <span className="text-default-secondary"><Trans>Unknown</Trans></span>
          : <span>{formatDate(firstSeen)}</span>}
      </DossierField>
      <DossierField
        label={t`Last seen`}
        info={(
          <MetricInfo
            title={t`Last seen`}
            what={t`When the finding was last reported on this asset.`}
            how={t`The most recent last observation, across every source reporting it.`}
          />
        )}
      >
        {lastSeen === null
          ? <span className="text-default-secondary"><Trans>Unknown</Trans></span>
          : <span>{formatDate(lastSeen)}</span>}
      </DossierField>
      <DossierField label={t`State`}>
        <EvidenceStateChip state={state} kind="cve" origin={stateOrigin} dismissalType={dismissalType} />
        {stateDuration !== null && <span className="text-default-secondary">{stateDuration}</span>}
      </DossierField>
      {dismissalReasonCode != null && (
        <DossierField label={t`Set aside because`}>
          <span>{dismissalReasonLabel(dismissalReasonCode)}</span>
        </DossierField>
      )}
    </DossierFieldGrid>
  </DossierCard>
);
