import { t } from '@lingui/core/macro';
import { useParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { countAssessed } from '../defenses-utils';
import { useControlCapabilities } from '../hooks/use-source-reads';
import { capabilitiesAssessedTotalLabel } from '../source-labels';
import { DrataTile, SelfAssessmentTile } from './defense-source-tiles';
import { OnboardingStepLayout } from './onboarding-step-layout';
import { SeeAllLink } from './see-all-link';
import { SourcesSection } from './source-tile';

export const DefensesStep: FunctionComponent = () => {
  const { tenantId } = useParams({ from: '/_auth/$tenantId/{-$organizationId}/get-started/defenses' });
  const capabilities = useControlCapabilities();

  return (
    <OnboardingStepLayout
      stepKey="defenses"
      why={t`Your controls decide how much of an attack is stopped. A control left unassessed counts as absent, so your losses are overestimated.`}
    >
      <SourcesSection
        title={t`Defense sources`}
        total={capabilities === undefined ? undefined : capabilitiesAssessedTotalLabel(countAssessed(capabilities), capabilities.length)}
        columns={2}
        seeAll={<SeeAllLink to="/$tenantId/{-$organizationId}/controls" label={t`See all controls`} />}
      >
        <DrataTile tenantId={tenantId} />
        <SelfAssessmentTile />
      </SourcesSection>
    </OnboardingStepLayout>
  );
};
