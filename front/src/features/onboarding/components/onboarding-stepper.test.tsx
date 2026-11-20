/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { DECLARED_ESTATE_KIND_VALUES, EMPTY_FINANCIAL_PROFILE_ANSWERS } from '@app/module/client';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OnboardingWizard } from '../onboarding-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { OnboardingStepper } from './onboarding-stepper';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ to, className, children, ...rest }: { to: string, className?: string, children: ReactNode, 'aria-current'?: 'step' }) => (
    <a href={to} className={className} aria-current={rest['aria-current']}>{children}</a>
  ),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const connector = (source: string, state: string) => ({ source, state, platformConfigured: true, activeRun: null });

const wizardWith = (steps: Partial<OnboardingWizard['steps']>): OnboardingWizard => ({
  id: 'wizard-id',
  organizationId: 'scope-id',
  steps: { company: 'todo', assets: 'todo', threats: 'todo', defenses: 'todo', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo', ...steps },
  finished: false,
});

/** A ring is the only svg a step circle holds besides its check, which carries the lucide class. */
const ringOf = (link: HTMLElement) => Array.from(link.querySelectorAll('svg')).find((svg) => !svg.classList.contains('lucide'));
const checkOf = (link: HTMLElement) => link.querySelector('svg.lucide-check');

describe('OnboardingStepper', () => {
  it('links every step to its page, the current one marked', () => {
    renderWithTrpc(<OnboardingStepper currentStep={1} wizard={wizardWith({ company: 'done' })} />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['company', 'assets', 'threats', 'defenses', 'finances', 'tolerance', 'protect', 'scenarios']);
    expect(links.filter((link) => link.getAttribute('aria-current') === 'step').map((link) => link.getAttribute('href'))).toEqual(['assets']);
  });

  it('rings the step a source imports behind, by the overview rule', async () => {
    renderWithTrpc(<OnboardingStepper currentStep={0} wizard={wizardWith({})} />, {
      answers: { 'connectors.listConnectors': [connector('microsoft_graph', 'syncing'), connector('opencti', 'ready')] },
    });

    const assets = screen.getByRole('link', { name: /Assets/ });
    expect(await within(assets).findByText('Syncing')).toBeTruthy();
    expect(screen.getAllByText('Syncing')).toHaveLength(1);
    expect(within(screen.getByRole('link', { name: /Threats/ })).queryByText('Syncing')).toBeNull();
  });

  it('shows a started step with its number inside a ring filled to its progress, and a hidden label', async () => {
    renderWithTrpc(<OnboardingStepper currentStep={0} wizard={wizardWith({ finances: 'started' })} />, {
      answers: { 'financialProfiles.getFinancialProfile': { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, annualRevenue: 5_000_000, regulatoryRegime: 'dora' } },
    });

    const finances = screen.getByRole('link', { name: /Finances/ });
    await waitFor(() => expect(ringOf(finances)).toBeTruthy());
    expect(checkOf(finances)).toBeNull();
    expect(finances.textContent).toContain('5');
    expect(within(finances).getByText('Started, 2 of 21')).toBeTruthy();
    expect(ringOf(finances)?.querySelector('[stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe('10 100');
  });

  it('rings a started Defenses step by the capabilities assessed', async () => {
    const capability = (assessed: boolean) => ({ domain: 'identity', position: 1, assessment: assessed ? { strengthMode: 'manual', coverageMode: 'manual' } : null });
    renderWithTrpc(<OnboardingStepper currentStep={0} wizard={wizardWith({ defenses: 'started' })} />, {
      answers: { 'controlCapabilities.getControlCapabilities': [capability(true), capability(false), capability(false), capability(false)] },
    });

    const defenses = screen.getByRole('link', { name: /Defenses/ });
    expect(await within(defenses).findByText('Started, 1 of 4')).toBeTruthy();
    expect(ringOf(defenses)?.querySelector('[stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe('25 100');
  });

  it('rings a started Assets step by the declared kinds out of the twelve', async () => {
    const row = (kind: string, bounds: { low: number, high: number } | null) => ({ kind, bounds, internetFacing: null, setAt: null, setByName: null });
    renderWithTrpc(<OnboardingStepper currentStep={0} wizard={wizardWith({ assets: 'started' })} />, {
      answers: { 'declaredEstate.get': [row('workstations', { low: 1, high: 2 }), row('servers', { low: 0, high: 0 }), row('people', null)] },
    });

    const assets = screen.getByRole('link', { name: /Assets/ });
    expect(await within(assets).findByText(`Started, 2 of ${DECLARED_ESTATE_KIND_VALUES.length}`)).toBeTruthy();
  });

  it('checks a done step and draws no ring on it', () => {
    renderWithTrpc(<OnboardingStepper currentStep={0} wizard={wizardWith({ company: 'done' })} />);

    const company = screen.getByRole('link', { name: /Company/ });
    expect(checkOf(company)).toBeTruthy();
    expect(ringOf(company)).toBeUndefined();
  });

  it('draws no progress ring on a step that is to do', () => {
    renderWithTrpc(<OnboardingStepper currentStep={0} wizard={wizardWith({})} />);

    expect(ringOf(screen.getByRole('link', { name: /Finances/ }))).toBeUndefined();
  });
});
