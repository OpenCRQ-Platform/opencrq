import { Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { LinkTarget } from './protect-templates';
import { Loader } from '../../../components/ui/loader';
import { useTRPC } from '../../../lib';
import { ManagePrimaryAssetDependenciesDrawer } from '../../asset-dependencies/components/manage-dependencies-drawer';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { primaryAssetsCountLabel } from '../protect-labels';
import { OnboardingStepLayout } from './onboarding-step-layout';
import { ProtectAssetsGraph } from './protect-assets-graph';
import { ProtectTemplates } from './protect-templates';
import { SeeAllLink } from './see-all-link';

const ProtectForm: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const [linking, setLinking] = useState<{ target: LinkTarget, open: boolean } | null>(null);
  const { data: assets } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions({ organizationId }));

  const linkAssets = (target: LinkTarget) => setLinking({ target, open: true });

  return (
    <OnboardingStepLayout
      stepKey="protect"
      title={t`What you protect`}
      why={t`Your primary assets say what an attack can reach and what it would cost you. Scenarios are built on them.`}
    >
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3" aria-labelledby="protect-choose-title">
          <div className="flex items-end justify-between gap-4">
            <Text as="h3" variant="title-xs" id="protect-choose-title">{t`1. Choose what you protect`}</Text>
            <span className="flex items-baseline gap-4">
              <Text as="p" variant="content-base-medium" className="tabular-nums" role="status">
                {assets === undefined ? undefined : primaryAssetsCountLabel(assets.length)}
              </Text>
              <SeeAllLink to="/$tenantId/{-$organizationId}/primary-assets" organizationId={organizationId} label={t`See all primary assets`} />
            </span>
          </div>
          <ProtectTemplates organizationId={organizationId} assets={assets ?? []} onLink={linkAssets} />
        </section>
        {assets !== undefined && assets.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="protect-link-title">
            <Text as="h3" variant="title-xs" id="protect-link-title">{t`2. Link the assets that support it`}</Text>
            <ProtectAssetsGraph assets={assets} onLink={linkAssets} />
          </section>
        )}
      </div>

      {linking !== null && (
        <ManagePrimaryAssetDependenciesDrawer
          open={linking.open}
          onClose={() => setLinking({ ...linking, open: false })}
          primaryAssetId={linking.target.id}
          primaryAssetName={linking.target.name}
        />
      )}
    </OnboardingStepLayout>
  );
};

export const ProtectStep: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();

  if (wizard === null || wizard === undefined) {
    return <Loader />;
  }

  return <ProtectForm organizationId={wizard.organizationId} />;
};
