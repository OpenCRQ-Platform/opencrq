import { t } from '@lingui/core/macro';
import { useParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { HiddenThreatsNotice } from '../../threats/components/hidden-threats-notice';
import { useThreatCount, useThreatsHidden } from '../hooks/use-source-reads';
import { threatsTotalLabel } from '../source-labels';
import { OnboardingStepLayout } from './onboarding-step-layout';
import { SeeAllLink } from './see-all-link';
import { SourcesSection } from './source-tile';
import { DefaultThreatsTile, OpenctiTile, StixTile } from './threat-source-tiles';

export const ThreatsStep: FunctionComponent = () => {
  const { tenantId } = useParams({ from: '/_auth/$tenantId/{-$organizationId}/get-started/threats' });
  const total = useThreatCount();
  const hidden = useThreatsHidden();

  return (
    <OnboardingStepLayout
      stepKey="threats"
      why={t`The attacker groups that target your sector and your country, and their techniques, drive the simulated attacks. Without a threat source, no scenario can be computed.`}
    >
      {hidden && <HiddenThreatsNotice />}
      <SourcesSection
        title={t`Threat sources`}
        total={total === undefined ? undefined : threatsTotalLabel(total)}
        columns={3}
        seeAll={<SeeAllLink to="/$tenantId/{-$organizationId}/threat-center" label={t`See all threats`} />}
      >
        <DefaultThreatsTile />
        <OpenctiTile tenantId={tenantId} />
        <StixTile />
      </SourcesSection>
    </OnboardingStepLayout>
  );
};
