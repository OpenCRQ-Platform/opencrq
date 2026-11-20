/** @vitest-environment jsdom */
import { DECLARED_ESTATE_KIND_VALUES, EMPTY_FINANCIAL_PROFILE_ANSWERS } from '@app/module/client';
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OnboardingWizard } from '../onboarding-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { GetStartedPage } from './get-started-page';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children, className }: { children: ReactNode, className?: string }) => <a href="#link" className={className}>{children}</a>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const wizardWith = (steps: Partial<OnboardingWizard['steps']>): OnboardingWizard => {
  const all: OnboardingWizard['steps'] = { company: 'todo', assets: 'todo', threats: 'todo', defenses: 'todo', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo', ...steps };
  return { id: 'wizard-id', organizationId: 'scope-id', steps: all, finished: Object.values(all).every((status) => status !== 'todo') };
};

const row = (label: string) => {
  const item = screen.getAllByRole('listitem').find((candidate) => within(candidate).queryByText(label) !== null);
  if (item === undefined) {
    throw new Error(`No row for ${label}`);
  }
  return item;
};

const estateRow = (kind: string, bounds: { low: number, high: number } | null) => ({ kind, bounds, internetFacing: null, setAt: null, setByName: null });

const renderPage = (wizard: OnboardingWizard, answers: Record<string, unknown> = {}) => renderWithTrpc(<GetStartedPage />, {
  answers: { 'onboardingWizard.getOnboardingWizard': wizard, 'connectors.listConnectors': [], ...answers },
});

describe('GetStartedPage counter', () => {
  it('counts the done steps only, and says how many are started', async () => {
    renderPage(wizardWith({ company: 'done', assets: 'done', threats: 'done', protect: 'done', scenarios: 'done', tolerance: 'done', finances: 'started', defenses: 'started' }));

    expect(await screen.findByText('6 of 8 steps done · 2 started')).toBeTruthy();
  });

  it('words a single started step', async () => {
    renderPage(wizardWith({ company: 'done', finances: 'started' }));

    expect(await screen.findByText('1 of 8 steps done · 1 started')).toBeTruthy();
  });

  it('says nothing of started steps when none is', async () => {
    renderPage(wizardWith({ company: 'done' }));

    expect(await screen.findByText('1 of 8 steps done')).toBeTruthy();
  });
});

describe('GetStartedPage rows', () => {
  it('checks a done step and gives a started one its number inside a progress ring, with its caption', async () => {
    renderPage(
      wizardWith({ company: 'done', finances: 'started' }),
      { 'financialProfiles.getFinancialProfile': { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, annualRevenue: 5_000_000, regulatoryRegime: 'dora' } },
    );

    expect(await screen.findByText('2 of 21 answered')).toBeTruthy();
    const finances = row('Finances');
    expect(finances.querySelector('svg.lucide-check')).toBeNull();
    expect(finances.querySelector('svg[stroke-dasharray], svg [stroke-dasharray]')).not.toBeNull();
    expect(within(finances).getByText('5')).toBeTruthy();
    expect(row('Company').querySelector('svg.lucide-check')).not.toBeNull();
  });

  it('draws no ring on a step that is to do', async () => {
    renderPage(wizardWith({ company: 'done' }));

    await screen.findByText('1 of 8 steps done');
    expect(row('Finances').querySelector('[stroke-dasharray]')).toBeNull();
  });

  it('shows the declared kinds out of the twelve on a started Assets row', async () => {
    renderPage(
      wizardWith({ assets: 'started' }),
      { 'declaredEstate.get': [estateRow('workstations', { low: 1, high: 2 }), estateRow('servers', { low: 0, high: 0 }), estateRow('people', null)] },
    );

    expect(await screen.findByText(`2 of ${DECLARED_ESTATE_KIND_VALUES.length} kinds declared`)).toBeTruthy();
    await waitFor(() => expect(row('Assets').querySelector('[stroke-dasharray]')).not.toBeNull());
  });

  it('shows the assessed capabilities on a started Defenses row', async () => {
    const capability = (assessed: boolean) => ({ domain: 'identity', position: 1, assessment: assessed ? { strengthMode: 'manual', coverageMode: 'manual' } : null });
    renderPage(wizardWith({ defenses: 'started' }), { 'controlCapabilities.getControlCapabilities': [capability(true), capability(false)] });

    expect(await screen.findByText('1 of 2 assessed')).toBeTruthy();
  });
});
