import { Button, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { uuidv7 } from 'uuidv7';
import type { ScenarioSuggestion } from '../scenarios-utils';
import { Loader } from '../../../components/ui/loader';
import { useTRPC } from '../../../lib';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { useCompatibleCategoryIds } from '../hooks/use-source-reads';
import { suggestionName } from '../scenarios-labels';
import { buildScenarioSuggestions, isSuggestionChecked } from '../scenarios-utils';
import { OnboardingStepLayout } from './onboarding-step-layout';
import { CreatedScenarioRow, NoPrimaryAssetNotice, SuggestionCard } from './scenario-cards';
import { SeeAllLink } from './see-all-link';

const ScenariosForm: FunctionComponent<{ organizationId: string, tenantId: string }> = ({ organizationId, tenantId }) => {
  const trpc = useTRPC();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState<ReadonlySet<string>>(new Set());
  const { data: outcomes } = useQuery(trpc.attackOutcomes.getAttackOutcomes.queryOptions());
  const { data: assets } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions({ organizationId }));
  const { data: scenarios } = useQuery(trpc.riskScenarios.getRiskScenariosOverview.queryOptions({ organizationId }));
  const compatibleCategoryIds = useCompatibleCategoryIds((outcomes ?? []).map((outcome) => outcome.id));
  const createRiskScenario = useMutation(trpc.riskScenarios.createRiskScenario.mutationOptions({ meta: { skipSuccessToast: true } }));

  const loaded = outcomes !== undefined && assets !== undefined && scenarios !== undefined && compatibleCategoryIds !== undefined;
  const suggestions = loaded
    ? buildScenarioSuggestions({ tenantId, outcomes, assets, compatibleCategoryIds, existing: scenarios })
    : [];
  const chosen = suggestions.filter((suggestion) => isSuggestionChecked(suggestion, overrides) && !creating.has(suggestion.outcomeId));

  const settle = (outcomeId: string) => setCreating((current) => new Set([...current].filter((id) => id !== outcomeId)));

  /*
   * A card stays "creating" until the scope's scenarios list shows its scenario, which drops the suggestion.
   * Creating a scenario books its first simulation through its recompute, so asking for one here would run it twice.
   */
  const createAndCompute = (selected: ReadonlyArray<ScenarioSuggestion>) => {
    setCreating((current) => new Set([...current, ...selected.map((suggestion) => suggestion.outcomeId)]));
    for (const suggestion of selected) {
      void createRiskScenario.mutateAsync({
        id: uuidv7(),
        organizationId,
        name: suggestionName(suggestion),
        description: null,
        attackOutcomeId: suggestion.outcomeId,
        primaryAssetIds: suggestion.primaryAssets.map((asset) => asset.id),
      }).catch(() => settle(suggestion.outcomeId));
    }
  };

  return (
    <OnboardingStepLayout
      stepKey="scenarios"
      title={t`Your first scenarios`}
      why={t`A scenario pairs an attack outcome with what it reaches. OpenCRQ simulates thousands of attacks to estimate your annual loss.`}
    >
      {!loaded && <Loader />}

      {loaded && scenarios.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <Text as="h3" variant="title-xs">{t`Your scenarios`}</Text>
            <SeeAllLink to="/$tenantId/{-$organizationId}/risk-scenarios" organizationId={organizationId} label={t`See all risk scenarios`} />
          </div>
          <div className="flex flex-col gap-3">
            {scenarios.map((scenario) => <CreatedScenarioRow key={scenario.id} scenario={scenario} />)}
          </div>
        </div>
      )}

      {loaded && suggestions.length > 0 && (
        <div className="flex flex-col gap-3">
          <Text as="h3" variant="title-xs">{t`Suggested scenarios`}</Text>
          <div className="grid grid-cols-2 items-stretch gap-4">
            {suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.outcomeId}
                suggestion={suggestion}
                checked={isSuggestionChecked(suggestion, overrides)}
                creating={creating.has(suggestion.outcomeId)}
                onToggle={() => setOverrides({ ...overrides, [suggestion.outcomeId]: !isSuggestionChecked(suggestion, overrides) })}
              />
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="button" disabled={chosen.length === 0} onClick={() => createAndCompute(chosen)}>
              {t`Create and compute`}
            </Button>
          </div>
        </div>
      )}

      {loaded && assets.length === 0 && <NoPrimaryAssetNotice />}

      {loaded && assets.length > 0 && suggestions.length === 0 && scenarios.length === 0 && (
        <Text as="p" variant="content-compact" role="status">
          {t`No scenario to suggest: none of your primary assets can be reached by an attack outcome. Add primary assets in the Protect step.`}
        </Text>
      )}
    </OnboardingStepLayout>
  );
};

export const ScenariosStep: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();
  const { tenantId } = useParams({ from: '/_auth/$tenantId/{-$organizationId}/get-started/scenarios' });

  if (wizard === null || wizard === undefined) {
    return <Loader />;
  }

  return <ScenariosForm organizationId={wizard.organizationId} tenantId={tenantId} />;
};
