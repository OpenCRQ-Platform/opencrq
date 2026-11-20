import { Card, CardHeader, CardOverview, CardTitle, Chip, Paper, Spinner, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, ShieldAlert } from 'lucide-react';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent } from 'react';
import type { OnboardingStepKey } from '../onboarding-steps';
import type { ScenarioSuggestion } from '../scenarios-utils';
import { useTRPC } from '../../../lib';
import { ScenarioAleCell, ScenarioReadinessBadge } from '../../risk-scenarios/components/list';
import { getStepLink } from '../onboarding-links';
import { ONBOARDING_STEPS } from '../onboarding-steps';
import { suggestionOutcomeLabel, suggestionTargetLabel } from '../scenarios-labels';
import { hasScenarioFigure, readinessStepKey } from '../scenarios-utils';
import { SourceGlyph } from './source-tile';

type RiskScenarioRow = inferRouterOutputs<TRPCRouter>['riskScenarios']['getRiskScenariosOverview'][number];

interface SuggestionCardProps {
  suggestion: ScenarioSuggestion,
  checked: boolean,
  /** The scenario is being created: the card waits for it to appear among the scope's scenarios. */
  creating: boolean,
  onToggle: () => void,
}

export const SuggestionCard: FunctionComponent<SuggestionCardProps> = ({ suggestion, checked, creating, onToggle }) => (
  <Card padding={16} gap={16} selected={checked && !creating} disabled={creating} onClick={onToggle}>
    <CardHeader icon={<SourceGlyph icon={ShieldAlert} />}>
      <CardOverview>{creating ? t`Creating…` : suggestionTargetLabel(suggestion)}</CardOverview>
      <CardTitle
        as="h3"
        endAdornment={creating
          ? <Spinner size="sm" tone="inherit" />
          : checked ? <Check className="size-4" role="img" aria-label={t`Selected`} /> : undefined}
      >
        {suggestionOutcomeLabel(suggestion)}
      </CardTitle>
    </CardHeader>
  </Card>
);

type CreatedScenario = Pick<RiskScenarioRow, 'id' | 'name' | 'noMappedAsset' | 'latestRun' | 'readiness'>;

const ReadinessLink: FunctionComponent<{ stepKey: OnboardingStepKey }> = ({ stepKey }) => {
  const label = ONBOARDING_STEPS.find((step) => step.key === stepKey)?.label() ?? '';
  return (
    <Link {...getStepLink(stepKey)} className="text-primary underline-offset-4 hover:underline">
      <Text as="span" variant="content-compact">{t`Complete ${label}`}</Text>
    </Link>
  );
};

/** What a created scenario says on its card: its figure once a run priced it, else the computation under way, else what it waits for. */
const ScenarioOutcomeBody: FunctionComponent<{ scenario: CreatedScenario }> = ({ scenario }) => {
  const trpc = useTRPC();
  const figure = hasScenarioFigure(scenario);
  const { data: computation, isPending } = useQuery(trpc.crqIndicators.getPendingComputation.queryOptions(
    { riskScenarioId: scenario.id },
    { enabled: !figure, meta: { skipErrorToast: true } },
  ));

  if (figure) {
    return (
      // The shared cell lines its figure and band up on the left: right-aligned here, the rows' figures share one edge.
      <div className="flex flex-col items-end gap-0.5 text-right">
        <Text as="span" variant="content-caption" className="text-default-secondary">{t`Expected annual loss`}</Text>
        <ScenarioAleCell latestRun={scenario.latestRun} noMappedAsset={scenario.noMappedAsset} />
      </div>
    );
  }
  if (isPending || computation?.pending) {
    return (
      <Chip label={t`Computing…`} severity="info" startIcon={<Spinner size="sm" tone="inherit" />} />
    );
  }
  const stepKey = readinessStepKey(scenario.readiness);
  return (
    <div className="flex flex-col items-end gap-1">
      <ScenarioReadinessBadge readiness={scenario.readiness} />
      {stepKey !== null && <ReadinessLink stepKey={stepKey} />}
    </div>
  );
};

/** A scenario targets primary assets, so a scope with none sends the reader to Protect. */
export const NoPrimaryAssetNotice: FunctionComponent = () => (
  <Text as="p" variant="content-compact" role="status">
    <Trans>Scenarios need a primary asset. Add one in the <Link {...getStepLink('protect')} className="text-primary underline-offset-4 hover:underline">Protect step</Link>.</Trans>
  </Text>
);

export const CreatedScenarioRow: FunctionComponent<{ scenario: CreatedScenario }> = ({ scenario }) => (
  <Paper elevation={2} padding={16} className="flex items-center justify-between gap-4">
    <Text as="h4" variant="content-base-medium" className="min-w-0 truncate">{scenario.name}</Text>
    <ScenarioOutcomeBody scenario={scenario} />
  </Paper>
);
