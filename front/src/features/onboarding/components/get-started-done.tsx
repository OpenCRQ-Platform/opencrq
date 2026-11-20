import { Button, Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { Box, ClipboardCheck, ListChecks, Scale, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { OnboardingWizard } from '../onboarding-utils';
import { useTRPC } from '../../../lib';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { getStepLink } from '../onboarding-links';
import { ONBOARDING_STEPS } from '../onboarding-steps';
import { computedScenariosLabel } from '../scenarios-labels';
import { countComputedScenarios } from '../scenarios-utils';
import { OnboardingStepper } from './onboarding-stepper';
import { SourceGlyph } from './source-tile';

const ActionRowContent: FunctionComponent<{ icon: LucideIcon, title: string, description: string }> = ({ icon, title, description }) => (
  <>
    <SourceGlyph icon={icon} />
    <span className="flex min-w-0 flex-col items-start gap-1">
      <Text as="span" variant="content-base-medium">{title}</Text>
      <Text as="span" variant="content-caption" className="text-default-secondary">{description}</Text>
    </span>
  </>
);

const FinishedPage: FunctionComponent<{ wizard: OnboardingWizard }> = ({ wizard }) => {
  const { organizationId } = wizard;
  const trpc = useTRPC();
  const { data: scenarios } = useQuery(trpc.riskScenarios.getRiskScenariosOverview.queryOptions({ organizationId }));
  const rowClassName = 'flex items-center gap-4 rounded-sm px-2 py-3 hover:bg-elevation-highlight';
  const scoped = (prev: { tenantId?: string }) => ({ ...prev, tenantId: prev.tenantId!, organizationId });

  const rows: Array<{ key: string, link: ReactNode }> = [
    {
      key: 'risk-scenarios',
      link: (
        <Link to="/$tenantId/{-$organizationId}/risk-scenarios" params={scoped} className={rowClassName}>
          <ActionRowContent icon={ShieldAlert} title={t`Risk scenarios`} description={t`Track your estimated annual losses`} />
        </Link>
      ),
    },
    {
      key: 'assets',
      link: (
        <Link to="/$tenantId/{-$organizationId}/assets" params={scoped} className={rowClassName}>
          <ActionRowContent icon={Box} title={t`Assets`} description={t`See which assets weigh most`} />
        </Link>
      ),
    },
    {
      key: 'treatment-plans',
      link: (
        <Link to="/$tenantId/{-$organizationId}/treatment-plans" params={scoped} className={rowClassName}>
          <ActionRowContent icon={ListChecks} title={t`Treatment plans`} description={t`Compare a measure's cost with the loss it avoids`} />
        </Link>
      ),
    },
    {
      key: 'budget-reviews',
      link: (
        <Link to="/$tenantId/{-$organizationId}/budget-reviews" params={scoped} className={rowClassName}>
          <ActionRowContent icon={Scale} title={t`Budget reviews`} description={t`Arbitrate your security budget`} />
        </Link>
      ),
    },
    {
      key: 'compliance',
      link: (
        <Link to="/$tenantId/{-$organizationId}/compliance" params={scoped} className={rowClassName}>
          <ActionRowContent icon={ClipboardCheck} title={t`Compliance`} description={t`Assess yourself against NIST CSF 2.0`} />
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <Text as="h1" variant="title-xl">{t`Get started`}</Text>
      <OnboardingStepper currentStep={ONBOARDING_STEPS.length} wizard={wizard} />
      <Paper padding={24} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Text as="h2" variant="title-md">{t`Your platform is set up`}</Text>
          {scenarios !== undefined && (
            <Text as="p" variant="content-base" className="text-default-secondary" role="status">
              {computedScenariosLabel(countComputedScenarios(scenarios))}
            </Text>
          )}
        </div>
        <div>
          <Button asChild>
            <Link to="/$tenantId/{-$organizationId}/risk-scenarios" params={scoped}>{t`See your risk scenarios`}</Link>
          </Button>
        </div>
      </Paper>
      <div className="flex flex-col gap-3">
        <Text as="h2" variant="title-sm">{t`What you can do now`}</Text>
        <Paper padding={16}>
          <ul className="flex flex-col divide-y divide-[var(--fds-border-elevation-subtle)]">
            {rows.map((row) => <li key={row.key}>{row.link}</li>)}
          </ul>
        </Paper>
      </div>
    </div>
  );
};

/** Reached once every step is done; a reader who opens it early is sent back to the overview. */
export const GetStartedDone: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();

  if (wizard === null || wizard === undefined) {
    return null;
  }
  if (!wizard.finished) {
    return <Navigate {...getStepLink(null)} replace />;
  }
  return <FinishedPage wizard={wizard} />;
};
