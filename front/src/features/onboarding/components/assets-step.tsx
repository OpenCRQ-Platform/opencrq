import { t } from '@lingui/core/macro';
import { useParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { Loader } from '../../../components/ui/loader';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { useAssetCount } from '../hooks/use-source-reads';
import { assetsTotalLabel } from '../source-labels';
import { AssetSourceTiles } from './asset-source-tiles';
import { OnboardingStepLayout } from './onboarding-step-layout';
import { SeeAllLink } from './see-all-link';
import { SourcesSection } from './source-tile';

const AssetsForm: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const { tenantId } = useParams({ from: '/_auth/$tenantId/{-$organizationId}/get-started/assets' });
  const total = useAssetCount();

  return (
    <OnboardingStepLayout
      stepKey="assets"
      why={t`Your assets and their vulnerabilities tell OpenCRQ where an attacker can get in.`}
    >
      <SourcesSection
        title={t`Asset sources`}
        total={total === undefined ? undefined : assetsTotalLabel(total)}
        columns={3}
        seeAll={<SeeAllLink to="/$tenantId/{-$organizationId}/assets" label={t`See all assets`} />}
      >
        <AssetSourceTiles tenantId={tenantId} organizationId={organizationId} />
      </SourcesSection>
    </OnboardingStepLayout>
  );
};

export const AssetsStep: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();

  if (wizard === null || wizard === undefined) {
    return <Loader />;
  }

  return <AssetsForm organizationId={wizard.organizationId} />;
};
