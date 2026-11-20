/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrpcAnswers } from '../../../providers/trpc-test-harness';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS } from '../../financial-profiles';
import { FAILED, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { FinancesStep } from './finances-step';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#step">{children}</a>,
  useMatches: () => [],
  useNavigate: () => navigate,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  cleanup();
});

/** Renders the step against canned answers, and returns the inputs `saveFinancialProfile` was called with. */
const renderStep = (overrides: TrpcAnswers = {}) => {
  const saveInputs: Array<unknown> = [];
  renderWithTrpc(<FinancesStep />, {
    answers: {
      'onboardingWizard.getOnboardingWizard': {
        id: 'wizard-id',
        organizationId: 'scope-id',
        steps: {
          company: 'done', assets: 'done', threats: 'done', defenses: 'done', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo',
        },
        finished: false,
      },
      'organizations.getOrganization': { id: 'scope-id', name: 'Enterprise', revenueBand: null },
      'financialProfiles.getFinancialProfile': null,
      'financialProfiles.saveFinancialProfile': (input: unknown) => {
        saveInputs.push(input);
        return {};
      },
      ...overrides,
    },
  });

  return { saveInputs };
};

const revenueInput = () => screen.findByLabelText('Exact amount');

describe('FinancesStep', () => {
  it('shows the whole questionnaire with its progress', async () => {
    renderStep();

    expect(await screen.findByText('0 of 21 answered')).toBeTruthy();
    expect(screen.getByText('Would your organization pay a ransom?')).toBeTruthy();
    expect(screen.queryByText(/The full questionnaire is in the/)).toBeNull();
  });

  it('shows no form when the stored answers cannot be read, so nothing can overwrite them', async () => {
    const { saveInputs } = renderStep({ 'financialProfiles.getFinancialProfile': FAILED });

    expect(await screen.findByText('Your financial figures could not be loaded.')).toBeTruthy();
    expect(screen.queryByLabelText('Exact amount')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Next' })).not.toBeNull();
    expect(saveInputs).toEqual([]);
  });

  it('saves a typed number, with every other answer unchanged, when the field loses focus and not before', async () => {
    const { saveInputs } = renderStep({ 'financialProfiles.getFinancialProfile': { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, regulatoryRegime: 'dora' } });
    const input = await revenueInput();

    fireEvent.change(input, { target: { value: '250000000' } });
    expect(saveInputs).toEqual([]);
    fireEvent.blur(input);

    await vi.waitFor(() => {
      expect(saveInputs).toEqual([{
        organizationId: 'scope-id',
        answers: { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, regulatoryRegime: 'dora', annualRevenue: 250_000_000 },
      }]);
    });
  });

  it('saves a choice as soon as it is clicked', async () => {
    const { saveInputs } = renderStep();
    await revenueInput();

    fireEvent.click(screen.getByRole('button', { name: 'DORA' }));

    await vi.waitFor(() => {
      expect(saveInputs).toEqual([expect.objectContaining({ answers: expect.objectContaining({ regulatoryRegime: 'dora' }) })]);
    });
  });

  it('does not save when a field loses focus with nothing changed from the stored answers', async () => {
    const { saveInputs } = renderStep({ 'financialProfiles.getFinancialProfile': { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, annualRevenue: 5_000_000, regulatoryRegime: 'dora' } });
    const input = await revenueInput();

    fireEvent.focus(input);
    fireEvent.blur(input);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveInputs).toEqual([]);
  });

  it('does not save the same answers twice', async () => {
    const { saveInputs } = renderStep();
    const input = await revenueInput();

    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.blur(input);
    fireEvent.blur(input);

    await vi.waitFor(() => {
      expect(saveInputs).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveInputs).toHaveLength(1);
  });

  it('keeps Next a plain link that never saves', async () => {
    const { saveInputs } = renderStep();
    await revenueInput();

    const next = screen.getByRole('link', { name: 'Next' });

    expect(next.getAttribute('href')).toBe('#step');
    fireEvent.click(next);
    expect(saveInputs).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
