/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TreatmentPlanReturnCard } from './treatment-plan-return-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type Props = Parameters<typeof TreatmentPlanReturnCard>[0];
type Projection = NonNullable<Props['projection']>;

const projection = (overrides: Partial<Projection> = {}): Projection => ({
  scenarios: [],
  totalAleReduction: 486_000,
  pricedScenarioCount: 3,
  scopeScenarioCount: 7,
  expired: false,
  pricedAt: '2026-09-17T00:00:00.000Z',
  costYear1: 156_000,
  returnPercent: 211.5,
  ...overrides,
});

const renderCard = (props: Partial<Props> = {}) => render(
  createElement(TreatmentPlanReturnCard, {
    costOneOff: 120_000,
    costRecurringAnnual: 36_000,
    projection: projection(),
    onEditCost: vi.fn(),
    ...props,
  }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

describe('TreatmentPlanReturnCard', () => {
  it('should show the return the service computed, next to the saving and the first-year cost', () => {
    renderCard();

    expect(screen.getByText('+211.5%').className).toContain('text-green-600');
    expect(screen.getByText('$486K')).toBeTruthy();
    expect(screen.getByText('$156K')).toBeTruthy();
  });

  it('should print a dash for the return of a plan with no cost, and offer to enter one', () => {
    renderCard({
      costOneOff: null,
      costRecurringAnnual: null,
      projection: projection({ costYear1: null, returnPercent: null }),
    });

    expect(screen.getAllByText('-').length).toBe(2);
    expect(screen.getByText('Enter the cost')).toBeTruthy();
  });

  it('should print a dash for the return of a plan whose cost is zero, never an infinity', () => {
    renderCard({
      costOneOff: 0,
      costRecurringAnnual: null,
      projection: projection({ costYear1: 0, returnPercent: null }),
    });

    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.getAllByText('-').length).toBe(1);
    expect(screen.getByText('Edit the cost')).toBeTruthy();
  });

  it('should print a negative return in red', () => {
    renderCard({ projection: projection({ totalAleReduction: -50_000, returnPercent: -132.1 }) });

    expect(screen.getByText('-132.1%').className).toContain('text-red');
  });

  it('should leave a return that prints as 0% uncoloured, whatever side of zero it sits on', () => {
    renderCard({ projection: projection({ returnPercent: -0.03 }) });

    const figure = screen.getByText('0%');
    expect(figure.className).not.toContain('text-red');
    expect(figure.className).not.toContain('text-green-600');
  });

  it('should mark a projection priced against an earlier set of moves and keep its figures', () => {
    renderCard({ projection: projection({ expired: true }) });

    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('+211.5%')).toBeTruthy();
  });

  it('should hold every figure empty while the projection loads', () => {
    renderCard({ projection: undefined });

    expect(screen.getAllByText('-').length).toBe(3);
  });

  it('should open the cost for editing from its own header', () => {
    const onEditCost = vi.fn();
    renderCard({ onEditCost });

    fireEvent.click(screen.getByText('Edit the cost'));

    expect(onEditCost).toHaveBeenCalledOnce();
  });
});
