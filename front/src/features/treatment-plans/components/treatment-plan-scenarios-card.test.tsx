/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TreatmentPlanScenariosCard } from './treatment-plan-scenarios-card';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type Projection = Parameters<typeof TreatmentPlanScenariosCard>[0]['projection'];
type Scenario = Projection['scenarios'][number];

const scenario = (overrides: Partial<Scenario> = {}): Scenario => ({
  riskScenarioId: '00000000-0000-0000-0000-00000000000a',
  name: 'Ransomware on the production servers',
  readinessStatus: 'ready',
  state: 'priced',
  runId: '00000000-0000-0000-0000-0000000000ff',
  runCreatedAt: '2026-09-17T00:00:00.000Z',
  lefMean: 1.2,
  aleMean: 816_000,
  aleTargetMean: 485_000,
  aleReductionMean: 331_000,
  aleReductionP10: 240_000,
  aleReductionP90: 430_000,
  olderThanHeadline: false,
  ...overrides,
});

const projection = (overrides: Partial<Projection> = {}): Projection => ({
  scenarios: [scenario()],
  totalAleReduction: 331_000,
  pricedScenarioCount: 1,
  scopeScenarioCount: 1,
  expired: false,
  pricedAt: '2026-09-17T00:00:00.000Z',
  costYear1: null,
  returnPercent: null,
  ...overrides,
});

type CardProps = Parameters<typeof TreatmentPlanScenariosCard>[0];

const renderCard = (value: Projection, props: Partial<Omit<CardProps, 'projection'>> = {}) => render(
  createElement(TreatmentPlanScenariosCard, { projection: value, resimulation: 'hidden', onResimulate: vi.fn(), ...props }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

describe('TreatmentPlanScenariosCard', () => {
  it('should read a saving of zero as a figure, not as a scenario left unpriced', () => {
    renderCard(projection({
      scenarios: [scenario({ aleReductionMean: 0, aleTargetMean: 816_000, aleReductionP10: 0, aleReductionP90: 0 })],
      totalAleReduction: 0,
    }));

    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.queryByText('Not computed')).toBeNull();
  });

  it('should keep the figures of an expired projection and mark the simulation they come from', () => {
    renderCard(projection({
      scenarios: [scenario({ state: 'expired' })],
      expired: true,
    }));

    expect(screen.getAllByText('$331K').length).toBeGreaterThan(0);
    expect(screen.getByText('Expired').closest('td')?.textContent).toContain('Sep 17, 2026');
  });

  it('should mark a current figure read from a run older than the scenario\'s ALE', () => {
    renderCard(projection({ scenarios: [scenario({ olderThanHeadline: true })] }));

    expect(screen.getByText('Older than the ALE').closest('td')?.textContent).toContain('Sep 17, 2026');
  });

  it('should not mark a figure as recent as the scenario\'s ALE', () => {
    renderCard(projection());

    expect(screen.queryByText('Older than the ALE')).toBeNull();
  });

  it('should keep the spread of a saving off the row and on the figure it belongs to', () => {
    renderCard(projection());

    const spread = screen.getByText('p10 $240K, mean $331K, p90 $430K');
    expect(spread.className).toContain('sr-only');
  });

  it('should say the band is not computed on a run older than its columns, and keep the mean', () => {
    renderCard(projection({ scenarios: [scenario({ aleReductionP10: null, aleReductionP90: null })] }));

    expect(screen.getByText('Mean $331K, band not computed').className).toContain('sr-only');
  });

  it('should sign a whole band that sits below zero, rather than read it as a saving', () => {
    renderCard(projection({
      scenarios: [scenario({
        aleReductionMean: -50_000,
        aleTargetMean: 866_000,
        aleReductionP10: -120_000,
        aleReductionP90: -10_000,
      })],
      totalAleReduction: -50_000,
    }));

    expect(screen.getByText('p10 +$120K, mean +$50K, p90 +$10K')).toBeTruthy();
  });

  it('should read a plan that raises the exposure as a rise', () => {
    renderCard(projection({
      scenarios: [scenario({ aleReductionMean: -50_000, aleTargetMean: 866_000, aleReductionP10: null, aleReductionP90: null })],
      totalAleReduction: -50_000,
    }));

    expect(screen.getByText('$50K').className).toContain('text-red');
    expect(screen.getByText('(6.1%)')).toBeTruthy();
  });

  it('should list a scenario it could not price, with the action it needs and no figure', () => {
    renderCard(projection({
      scenarios: [scenario({
        name: 'Fraud on the payment gateway',
        readinessStatus: 'incomplete',
        state: 'not-priced',
        runId: null,
        runCreatedAt: null,
        lefMean: null,
        aleMean: null,
        aleTargetMean: null,
        aleReductionMean: null,
        aleReductionP10: null,
        aleReductionP90: null,
      })],
      totalAleReduction: null,
      pricedScenarioCount: 0,
      pricedAt: null,
    }));

    expect(screen.getByText('Fraud on the payment gateway')).toBeTruthy();
    expect(screen.getAllByText('Not computed').length).toBe(2);
  });

  it('should hold a plan whose scope has no scenario at all', () => {
    renderCard(projection({ scenarios: [], totalAleReduction: null, pricedScenarioCount: 0, pricedAt: null }));

    expect(screen.getByText('This risk scope holds no scenario to read the plan against.')).toBeTruthy();
  });

  describe('re-simulation', () => {
    it('should offer to re-simulate, and ask for it on a click', () => {
      const onResimulate = vi.fn();
      renderCard(projection({ scenarios: [scenario({ state: 'expired' })], expired: true }), { resimulation: 'ready', onResimulate });

      fireEvent.click(screen.getByRole('button', { name: 'Re-simulate scenarios' }));

      expect(onResimulate).toHaveBeenCalledOnce();
    });

    it('should refuse a second ask while the runs are in flight', () => {
      renderCard(projection(), { resimulation: 'running' });

      const button = screen.getByRole('button', { name: /Re-simulate scenarios/ });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
    });

    it('should not offer it when there is nothing to bring up to date', () => {
      renderCard(projection(), { resimulation: 'hidden' });

      expect(screen.queryByRole('button', { name: /Re-simulate scenarios/ })).toBeNull();
    });
  });
});
