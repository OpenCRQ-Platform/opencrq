/** @vitest-environment jsdom */
import type { ScenarioReadiness } from '@app/module/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RiskScenarioCardProps } from './risk-scenario-card';
import { RiskScenarioCard } from './risk-scenario-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderCard = (overrides: Partial<RiskScenarioCardProps>) => {
  const props: RiskScenarioCardProps = {
    id: 'scenario-1',
    name: 'Data Breach on Retail Lending Platform',
    organization: null,
    attackOutcome: { id: 'outcome-1', name: 'Data breach' },
    primaryAssets: [],
    owner: null,
    latestRun: null,
    lifeline: [],
    changeOverLifeline: null,
    readiness: { status: 'not-simulated', missing: [], outdated: [] } satisfies ScenarioReadiness,
    onDelete: vi.fn(),
    onNavigate: vi.fn(),
    onManageAssets: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider i18n={i18n}>
      <RiskScenarioCard {...props} />
    </I18nProvider>,
  );
  return props;
};

const NO_MAPPED_ASSET: ScenarioReadiness = { status: 'no-mapped-asset', missing: [], outdated: [] };

describe('RiskScenarioCard', () => {
  it('reads Not priced with No mapped asset when the scope holds nothing', () => {
    renderCard({ readiness: NO_MAPPED_ASSET, latestRun: { createdAt: new Date().toISOString(), aleP10: 1, aleMean: 2, aleP90: 3 } });

    expect(screen.getByText('Not priced')).toBeTruthy();
    expect(screen.getByText('No mapped asset')).toBeTruthy();
  });

  it('offers Manage assets instead of Simulate when the scope holds nothing', () => {
    renderCard({ readiness: NO_MAPPED_ASSET });

    expect(screen.getByText('Manage assets')).toBeTruthy();
    expect(screen.queryByText('Simulate')).toBeNull();
  });

  it('opens the scope mapping without navigating to the scenario', () => {
    const props = renderCard({ readiness: NO_MAPPED_ASSET });

    fireEvent.click(screen.getByText('Manage assets'));

    expect(props.onManageAssets).toHaveBeenCalledOnce();
    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  it('names the owner of the scenario', () => {
    renderCard({ owner: { id: 'user-1', name: 'Alice Martin' } });

    expect(screen.getByText('Alice Martin')).toBeTruthy();
  });

  it('reads the figure, its change and its band on a priced scenario', () => {
    renderCard({
      readiness: { status: 'ready', missing: [], outdated: [] },
      latestRun: { createdAt: new Date().toISOString(), aleP10: 1_000, aleMean: 2_000, aleP90: 3_000 },
      changeOverLifeline: { delta: 1_000, deltaPct: 0.5, spanDays: 30 },
    });

    expect(screen.getByText('$2K')).toBeTruthy();
    expect(screen.getByText('$1K (50%)')).toBeTruthy();
    expect(screen.getByText('p10 $1K - p90 $3K')).toBeTruthy();
    expect(screen.queryByText('Not priced')).toBeNull();
  });

  it('says the band is not computed on a priced scenario whose run predates it', () => {
    renderCard({
      readiness: { status: 'ready', missing: [], outdated: [] },
      latestRun: { createdAt: new Date().toISOString(), aleP10: null, aleMean: 2_000, aleP90: null },
    });

    expect(screen.getByText('$2K')).toBeTruthy();
    expect(screen.getByText('Band not computed')).toBeTruthy();
  });

  it('offers Simulate on a scenario the scope can price', () => {
    renderCard({ readiness: { status: 'not-simulated', missing: [], outdated: [] } });

    expect(screen.getByText('Simulate')).toBeTruthy();
    expect(screen.queryByText('Manage assets')).toBeNull();
  });
});
