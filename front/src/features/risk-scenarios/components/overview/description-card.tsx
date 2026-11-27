import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { SectionCard } from '../../../../components/shared';
import { EMPTY_VALUE } from '../../../../utils/empty-value';
import { BrokenRequirements } from '../../../requirements/components/broken-requirements';

type DescriptionCardProps = {
  riskScenarioId: string,
  description: string | null,
  primaryAssets: Array<{ id: string, name: string }>,
  attackOutcome: { name: string } | null,
  owner: { name: string | null } | null,
};

export const DescriptionCard: FunctionComponent<DescriptionCardProps> = ({ riskScenarioId, description, primaryAssets, attackOutcome, owner }) => (
  <SectionCard title={t`Description`} cardClassName="p-4">
    {description && <p>{description}</p>}
    <div className="flex flex-wrap items-center gap-4">
      {primaryAssets.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="txt-sub-content text-muted-foreground">
            <Trans>Primary Assets</Trans>:
          </span>
          <div className="flex flex-wrap gap-1">
            {primaryAssets.map((asset) => (
              <Chip key={asset.id} label={asset.name} />
            ))}
          </div>
        </div>
      )}
      {attackOutcome && (
        <div className="flex items-center gap-2">
          <span className="txt-sub-content text-muted-foreground">
            <Trans>Attack Outcome</Trans>:
          </span>
          <Chip label={attackOutcome.name} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="txt-sub-content text-muted-foreground">
          <Trans>Owner</Trans>:
        </span>
        {owner?.name ? <Chip label={owner.name} /> : <span className="txt-body2">{EMPTY_VALUE}</span>}
      </div>
      <BrokenRequirements riskScenarioId={riskScenarioId} />
    </div>
  </SectionCard>
);
