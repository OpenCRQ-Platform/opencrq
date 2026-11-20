/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { GetStartedDone } from './get-started-done';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
  Navigate: () => <div>Left for the overview</div>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const wizard = (finished: boolean) => ({
  id: 'wizard-id',
  organizationId: 'scope-id',
  steps: {
    company: 'done', assets: 'done', threats: 'done', defenses: 'done', finances: 'done', tolerance: 'done', protect: 'done', scenarios: finished ? 'done' : 'todo',
  },
  finished,
});

const renderDone = (finished: boolean, scenarios: Array<{ latestRun: unknown }> = []) => renderWithTrpc(<GetStartedDone />, {
  answers: {
    'onboardingWizard.getOnboardingWizard': wizard(finished),
    'riskScenarios.getRiskScenariosOverview': scenarios,
  },
});

describe('GetStartedDone', () => {
  it('says the platform is set up, with the scenarios computed on the scope', async () => {
    const { calls } = renderDone(true, [{ latestRun: { aleMean: 1 } }, { latestRun: { aleMean: 2 } }, { latestRun: null }]);

    expect(await screen.findByRole('heading', { name: 'Your platform is set up' })).toBeTruthy();
    expect(await screen.findByText('2 risk scenarios computed')).toBeTruthy();
    expect(calls.find((call) => call.path === 'riskScenarios.getRiskScenariosOverview')?.input).toEqual({ organizationId: 'scope-id' });
  });

  it('counts a single computed scenario in the singular', async () => {
    renderDone(true, [{ latestRun: { aleMean: 1 } }]);

    expect(await screen.findByText('1 risk scenario computed')).toBeTruthy();
  });

  it('leads to the risk scenarios, and lists what to do now', async () => {
    renderDone(true);

    expect(await screen.findByText('See your risk scenarios')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What you can do now' })).toBeTruthy();
    for (const [title, description] of [
      ['Risk scenarios', 'Track your estimated annual losses'],
      ['Assets', 'See which assets weigh most'],
      ['Treatment plans', "Compare a measure's cost with the loss it avoids"],
      ['Budget reviews', 'Arbitrate your security budget'],
      ['Compliance', 'Assess yourself against NIST CSF 2.0'],
    ] as const) {
      const actions = within(screen.getByRole('list'));
      expect(actions.getByText(title)).toBeTruthy();
      expect(actions.getByText(description)).toBeTruthy();
    }
  });

  it('sends a reader back to the overview while the wizard is not finished', async () => {
    renderDone(false);

    expect(await screen.findByText('Left for the overview')).toBeTruthy();
    expect(screen.queryByText('Your platform is set up')).toBeNull();
  });
});
