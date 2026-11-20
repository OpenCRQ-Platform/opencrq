import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { TopControlToImprove } from '../../use-scenario-control-rows';
import { ControlIdPill, SectionCard } from '../../../../components/shared';
import { formatDollar } from '../../../../utils';
import { ControlEvolutionBadges } from '../control-evolution-badges';
import { ScenarioMixturePendingNotice } from '../scenario-mixture-pending-notice';
import { NoDataOverlay } from './no-data-overlay';

const SKELETON_ROWS = 3;

// Each placeholder isolates a single axis (or the deploy step), stepping one notch, mirroring the real suggestions.
const PLACEHOLDER_ROWS: Array<TopControlToImprove> = [
  { controlId: '1', externalId: 'PAM', name: 'Privileged Access Management', controlKind: 'capability', dimension: 'strength', currentStrength: 'L2', upgradedStrength: 'L3', currentCoverage: 'L2', upgradedCoverage: 'L2', aleReduction: 48000 },
  { controlId: '2', externalId: 'IDP', name: 'Identity Platform (IdP, SSO, MFA, Conditional Access)', controlKind: 'capability', dimension: 'deploy', currentStrength: 'L0', upgradedStrength: 'L1', currentCoverage: 'L0', upgradedCoverage: 'L1', aleReduction: 31000 },
  { controlId: '3', externalId: 'ITDR', name: 'Identity Threat Detection and Response', controlKind: 'capability', dimension: 'coverage', currentStrength: 'L1', upgradedStrength: 'L1', currentCoverage: 'L1', upgradedCoverage: 'L2', aleReduction: 19000 },
];

interface TopControlsCardProps {
  topControlsToImprove: Array<TopControlToImprove>,
  isLoading: boolean,
  hasWhatIfData: boolean,
  isMixturePending: boolean,
}

const ControlRow: FunctionComponent<{ control: TopControlToImprove }> = ({ control }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="flex min-w-0 items-center gap-2">
      <ControlIdPill externalId={control.externalId} size="compact" />
      <span className="txt-body2 min-w-0 truncate">{control.name}</span>
    </span>
    <div className="flex shrink-0 items-center gap-3">
      <ControlEvolutionBadges
        dimension={control.dimension}
        currentStrength={control.currentStrength}
        upgradedStrength={control.upgradedStrength}
        currentCoverage={control.currentCoverage}
        upgradedCoverage={control.upgradedCoverage}
      />
      <span className="txt-sub-content whitespace-nowrap text-green-600">
        -{formatDollar(control.aleReduction)}
      </span>
    </div>
  </div>
);

const TopControlsBody: FunctionComponent<Omit<TopControlsCardProps, 'isMixturePending'>> = ({ topControlsToImprove, isLoading, hasWhatIfData }) => {
  if (isLoading) {
    return Array.from({ length: SKELETON_ROWS }).map((_, i) => (
      <div key={i} className="flex items-center justify-between">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-12" />
      </div>
    ));
  }
  return (hasWhatIfData ? topControlsToImprove : PLACEHOLDER_ROWS).map((control) => (
    <ControlRow key={`${control.controlId}-${control.dimension}`} control={control} />
  ));
};

export const TopControlsCard: FunctionComponent<TopControlsCardProps> = ({ topControlsToImprove, isLoading, hasWhatIfData, isMixturePending }) => (
  <SectionCard title={t`Top Controls to Improve`} cardClassName="relative h-full overflow-hidden p-4">
    {isMixturePending
      ? <ScenarioMixturePendingNotice />
      : (
        <>
          {!isLoading && !hasWhatIfData && <NoDataOverlay />}
          <TopControlsBody topControlsToImprove={topControlsToImprove} isLoading={isLoading} hasWhatIfData={hasWhatIfData} />
        </>
      )}
  </SectionCard>
);
