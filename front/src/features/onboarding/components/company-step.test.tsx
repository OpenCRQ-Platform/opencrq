/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { CompanyStep } from './company-step';

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
  // jsdom implements neither, and Radix's select calls both when it opens.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  cleanup();
});

/** Renders the step against canned answers, and returns the inputs `updateOrganization` was called with. */
const renderStep = (stored: { employeeCount: number | null } = { employeeCount: null }) => {
  const updateInputs: Array<unknown> = [];
  renderWithTrpc(<CompanyStep />, {
    answers: {
      'onboardingWizard.getOnboardingWizard': {
        id: 'wizard-id',
        organizationId: 'scope-id',
        steps: {
          company: 'todo', assets: 'todo', threats: 'todo', defenses: 'todo', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo',
        },
        finished: false,
      },
      'organizations.getOrganization': { id: 'scope-id', name: 'Enterprise', sectorId: null, countryId: null, revenueBand: null, ...stored },
      'sectors.getSectors': [{ id: 'sector-id', name: 'Healthcare' }],
      'countries.getCountries': [],
      'organizations.updateOrganization': (input: unknown) => {
        updateInputs.push(input);
        return {};
      },
    },
  });

  return { updateInputs };
};

const nameInput = () => screen.findByRole('textbox', { name: /Name/ });
const employeeCountInput = () => screen.findByLabelText('Employee Count');

describe('CompanyStep', () => {
  it('saves only the sector as soon as it is picked', async () => {
    const { updateInputs } = renderStep();
    await nameInput();

    fireEvent.keyDown(screen.getByRole('combobox', { name: /Sector/ }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Healthcare' }));

    await vi.waitFor(() => {
      expect(updateInputs).toEqual([{ id: 'scope-id', sectorId: 'sector-id' }]);
    });
  });

  it('saves the trimmed name when the field loses focus, and not while it is typed', async () => {
    const { updateInputs } = renderStep();
    const input = await nameInput();

    fireEvent.change(input, { target: { value: '  Northwind Clinic ' } });
    expect(updateInputs).toEqual([]);
    fireEvent.blur(input);

    await vi.waitFor(() => {
      expect(updateInputs).toEqual([{ id: 'scope-id', name: 'Northwind Clinic' }]);
    });
  });

  it('does not save a blank name and shows its error', async () => {
    const { updateInputs } = renderStep();
    const input = await nameInput();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(await screen.findByText('A name is required')).toBeTruthy();
    expect(updateInputs).toEqual([]);
  });

  it('does not save a name that did not change', async () => {
    const { updateInputs } = renderStep();
    const input = await nameInput();

    fireEvent.focus(input);
    fireEvent.blur(input);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updateInputs).toEqual([]);
  });

  it('saves the employee count on blur', async () => {
    const { updateInputs } = renderStep();
    const input = await employeeCountInput();

    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);

    await vi.waitFor(() => {
      expect(updateInputs).toEqual([{ id: 'scope-id', employeeCount: 250 }]);
    });
  });

  it('saves a cleared employee count as null', async () => {
    const { updateInputs } = renderStep({ employeeCount: 250 });
    const input = await employeeCountInput();

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await vi.waitFor(() => {
      expect(updateInputs).toEqual([{ id: 'scope-id', employeeCount: null }]);
    });
  });

  it('does not save an employee count that is not a whole number', async () => {
    const { updateInputs } = renderStep();
    const input = await employeeCountInput();

    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.blur(input);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updateInputs).toEqual([]);
  });

  it('keeps Next a plain link that never saves', async () => {
    const { updateInputs } = renderStep();
    await nameInput();

    const next = screen.getByRole('link', { name: 'Next' });

    expect(next.getAttribute('href')).toBe('#step');
    fireEvent.click(next);
    expect(updateInputs).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
