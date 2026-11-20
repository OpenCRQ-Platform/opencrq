/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ToleranceStep } from './tolerance-step';

const navigate = vi.hoisted(() => vi.fn());
const blocker = vi.hoisted(() => ({
  options: null as { shouldBlockFn: () => boolean, enableBeforeUnload: boolean } | null,
  leave: () => {},
  proceed: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#step">{children}</a>,
  useMatches: () => [],
  useNavigate: () => navigate,
  /** A held navigation: `attemptLeave` asks the guard the way the router does and opens the resolver when it holds. */
  useBlocker: (options: { shouldBlockFn: () => boolean, enableBeforeUnload: boolean }) => {
    const [blocked, setBlocked] = useState(false);
    blocker.options = options;
    blocker.leave = () => setBlocked(options.shouldBlockFn());
    return { status: blocked ? 'blocked' : 'idle', reset: () => setBlocked(false), proceed: blocker.proceed };
  },
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  navigate.mockReset();
  blocker.proceed.mockReset();
  blocker.options = null;
  blocker.leave = () => {};
});

afterEach(() => {
  cleanup();
});

/** Renders the step against canned answers, and returns the inputs `setRiskTolerance` was called with. */
const renderStep = (tolerance: { annualLoss: number, maxExceedanceProbability: number } | null = null) => {
  const setInputs: Array<unknown> = [];
  const answers: Record<string, unknown> = {
    'onboardingWizard.getOnboardingWizard': {
      id: 'wizard-id',
      organizationId: 'scope-id',
      steps: {
        company: 'done', assets: 'done', threats: 'done', defenses: 'done', finances: 'done', tolerance: 'todo', protect: 'done', scenarios: 'done',
      },
      finished: false,
    },
    'organizations.getRiskTolerance': { tolerance },
    'organizations.setRiskTolerance': (input: unknown) => {
      setInputs.push(input);
      return {};
    },
  };
  renderWithTrpc(<ToleranceStep />, { answers });

  return { setInputs };
};

const attemptLeave = () => {
  act(() => blocker.leave());
};

const annualLossInput = () => screen.findByLabelText(/Annual loss/);
const probabilityInput = () => screen.findByLabelText(/Maximum probability of exceeding it/);
const typeAndLeave = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe('ToleranceStep', () => {
  it('saves a valid pair converted for the server as soon as the second field is left', async () => {
    const { setInputs } = renderStep();
    typeAndLeave(await annualLossInput(), '2000000');
    typeAndLeave(await probabilityInput(), '5');

    await vi.waitFor(() => {
      expect(setInputs).toEqual([{ organizationId: 'scope-id', tolerance: { annualLoss: 2_000_000, maxExceedanceProbability: 0.05 } }]);
    });
  });

  it('says nothing when the first field is left, only that both values are needed', async () => {
    const { setInputs } = renderStep();
    typeAndLeave(await annualLossInput(), '2000000');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('Both values are needed to save the tolerance.')).toBeTruthy();
    expect(screen.queryByText('Enter a maximum probability.')).toBeNull();
    expect(setInputs).toEqual([]);
  });

  it('shows the missing field once both fields were left, and saves nothing', async () => {
    const { setInputs } = renderStep();
    typeAndLeave(await annualLossInput(), '2000000');
    const probability = await probabilityInput();
    fireEvent.focus(probability);
    fireEvent.blur(probability);

    expect(await screen.findByText('Enter a maximum probability.')).toBeTruthy();
    expect(setInputs).toEqual([]);
  });

  it('says nothing and saves nothing when both fields are left blank', async () => {
    const { setInputs } = renderStep();
    const input = await annualLossInput();

    fireEvent.focus(input);
    fireEvent.blur(input);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Enter an annual loss.')).toBeNull();
    expect(setInputs).toEqual([]);
  });

  it('does not save a pair the scope already holds', async () => {
    const { setInputs } = renderStep({ annualLoss: 2_000_000, maxExceedanceProbability: 0.05 });
    const input = await annualLossInput();

    typeAndLeave(input, '2000000');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(setInputs).toEqual([]);
  });

  it('keeps Next a plain link that never saves, even with one field filled', async () => {
    const { setInputs } = renderStep();
    typeAndLeave(await annualLossInput(), '2000000');

    const next = screen.getByRole('link', { name: 'Next' });

    expect(next.getAttribute('href')).toBe('#step');
    fireEvent.click(next);
    expect(setInputs).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('leaving the step', () => {
    it('asks before leaving with one field filled, and says the tolerance will not be saved', async () => {
      renderStep();
      typeAndLeave(await annualLossInput(), '2000000');

      attemptLeave();

      expect(await screen.findByText('Incomplete tolerance')).toBeTruthy();
      expect(screen.getByText('The tolerance needs both values. Leave without saving it?')).toBeTruthy();
      expect(blocker.options?.enableBeforeUnload).toBe(true);
    });

    it('stays on the step and shows what is missing when the reader cancels', async () => {
      renderStep();
      typeAndLeave(await annualLossInput(), '2000000');
      attemptLeave();

      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

      expect(await screen.findByText('Enter a maximum probability.')).toBeTruthy();
      expect(screen.queryByText('Incomplete tolerance')).toBeNull();
      expect(blocker.proceed).not.toHaveBeenCalled();
    });

    it('lets the navigation through when the reader leaves without saving', async () => {
      const { setInputs } = renderStep();
      typeAndLeave(await annualLossInput(), '2000000');
      attemptLeave();

      fireEvent.click(await screen.findByRole('button', { name: 'Leave without saving' }));

      expect(blocker.proceed).toHaveBeenCalledOnce();
      expect(setInputs).toEqual([]);
    });

    it('asks when one field of a saved pair is cleared', async () => {
      renderStep({ annualLoss: 2_000_000, maxExceedanceProbability: 0.05 });
      typeAndLeave(await probabilityInput(), '');

      attemptLeave();

      expect(await screen.findByText('Incomplete tolerance')).toBeTruthy();
    });

    it('never asks with a blank form', async () => {
      renderStep();
      await annualLossInput();

      attemptLeave();

      expect(screen.queryByText('Incomplete tolerance')).toBeNull();
      expect(blocker.options?.enableBeforeUnload).toBe(false);
    });

    it('never asks with a saved pair', async () => {
      renderStep({ annualLoss: 2_000_000, maxExceedanceProbability: 0.05 });
      await annualLossInput();

      attemptLeave();

      expect(screen.queryByText('Incomplete tolerance')).toBeNull();
    });

    it('never asks once both fields are filled', async () => {
      const { setInputs } = renderStep();
      typeAndLeave(await annualLossInput(), '2000000');
      typeAndLeave(await probabilityInput(), '5');
      await vi.waitFor(() => expect(setInputs).toHaveLength(1));

      attemptLeave();

      expect(screen.queryByText('Incomplete tolerance')).toBeNull();
    });
  });
});
