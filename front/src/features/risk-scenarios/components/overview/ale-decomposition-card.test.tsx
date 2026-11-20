/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PeriodWindowId } from '../../../../components/shared';
import type { DecompositionRun } from './ale-decomposition-utils';
import { formatDate } from '../../../../utils';
import { EMPTY_VALUE } from '../../../../utils/empty-value';
import { AleDecompositionCard } from './ale-decomposition-card';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

let nextId = 0;

const run = (overrides: Partial<DecompositionRun> = {}): DecompositionRun => {
  nextId += 1;
  return {
    id: `run-${nextId}`,
    createdAt: new Date().toISOString(),
    aleMean: 1_000_000,
    aleP10: 500_000,
    aleP90: 2_000_000,
    tefMin: 1,
    tefLikely: 2,
    tefMax: 4,
    outcomeEvicted: 0.2,
    outcomeImpactDetected: 0.3,
    outcomeImpactUndetected: 0.1,
    magnitudeMean: 300_000,
    ...overrides,
  };
};

/** `runs` newest first, every one of them sampled. */
const renderCard = async (runs: ReadonlyArray<DecompositionRun>, unavailable = false, onWindowChange: (windowId: PeriodWindowId) => void = () => {}, pending = false) => {
  const timeline = { latest: runs.slice(0, 2), points: runs.toReversed(), until: new Date().toISOString() };
  const rootRoute = createRootRoute({ component: Outlet });
  const scenarioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
    component: (): ReactNode => (
      <I18nProvider i18n={i18n}>
        {/* Radix only mounts the hidden native select, and with it the echo, for a Select inside a form. */}
        <form>
          <AleDecompositionCard timeline={timeline} unavailable={unavailable} pending={pending} windowId="90d" onWindowChange={onWindowChange} />
        </form>
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scenarioRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1/risk-scenarios/scenario-1'] }),
  });
  const rendered = render(<RouterProvider router={router} />);
  await screen.findByText('Annual Loss Exposure');
  return rendered;
};

const selectWindow = (windowId: string) => {
  const select = document.querySelector('select');
  if (select === null) {
    throw new Error('the hidden native select Radix echoes from is missing');
  }
  fireEvent.change(select, { target: { value: windowId } });
};

const curveLabel = (name: RegExp): string | null => screen.getByRole('img', { name }).getAttribute('aria-label');

const factorPaper = (title: string): HTMLElement => {
  const paper = screen.getByText(title).parentElement;
  if (paper === null) {
    throw new Error(`the ${title} paper is missing`);
  }
  return paper;
};

const CURVES = [
  /Annual loss exposure over time/,
  /Threat event frequency over time/,
  /Effective susceptibility over time/,
  /Loss magnitude over time/,
];

describe('AleDecompositionCard', () => {
  it('should ask for the period selected', async () => {
    const onWindowChange = vi.fn();
    await renderCard([run()], false, onWindowChange);
    selectWindow('12m');
    expect(onWindowChange).toHaveBeenCalledWith('12m');
  });

  it('should dim every curve and announce the load while the new period is on its way', async () => {
    await renderCard([run()], false, () => {}, true);
    expect(await screen.findByText('Loading')).toBeDefined();
    for (const curve of CURVES) {
      expect(screen.getByRole('img', { name: curve }).closest('.opacity-40')).not.toBeNull();
    }
  });

  it('should leave the curves undimmed once the period is loaded', async () => {
    const { container } = await renderCard([run()]);
    expect(screen.queryByText('Loading')).toBeNull();
    expect(container.querySelector('.opacity-40')).toBeNull();
  });

  it('should draw all four curves from the first sampled run', async () => {
    const oldDate = new Date(Date.now() - 200 * DAY_MS);
    await renderCard([run(), run({ createdAt: oldDate.toISOString(), aleMean: 400_000, tefLikely: 1.5, magnitudeMean: 200_000 })]);
    for (const curve of CURVES) {
      expect(curveLabel(curve)).toContain(formatDate(oldDate));
    }
  });

  it('should make the covered content inert while the data is unavailable', async () => {
    const { container } = await renderCard([run()], true);
    expect(screen.getByText('Insufficient data')).toBeDefined();
    expect(container.querySelector('[inert]')).not.toBeNull();
  });

  it('should leave the content reachable once the data is available', async () => {
    const { container } = await renderCard([run(), run()]);
    expect(screen.queryByText('Insufficient data')).toBeNull();
    expect(container.querySelector('[inert]')).toBeNull();
  });

  it('should print no change and no previous value for a single run', async () => {
    await renderCard([run()]);
    expect(screen.queryByText(/^[+−]/)).toBeNull();
    expect(screen.queryByText(/pts$/)).toBeNull();
    expect(screen.getByText(/per year on average/).textContent).toBe('per year on average · $500K to $2.0M');
  });

  it('should print the previous value and its date beside the band', async () => {
    const previousDate = new Date(Date.now() - 3 * DAY_MS);
    await renderCard([run(), run({ createdAt: previousDate.toISOString(), aleMean: 800_000 })]);
    expect(screen.getByText(/per year on average/).textContent).toContain(`$800K on ${formatDate(previousDate)}`);
  });

  it('should read the TEF as empty when the latest run has none', async () => {
    await renderCard([run({ tefMin: null, tefLikely: null, tefMax: null, aleMean: null, aleP10: null, aleP90: null })]);
    expect(within(factorPaper('Threat event frequency (TEF)')).getByText(EMPTY_VALUE)).toBeDefined();
  });

  it('should hide the p10 to p90 line when the latest run has no band', async () => {
    await renderCard([run({ aleP10: null, aleP90: null })]);
    expect(screen.queryByText(/per year on average/)).toBeNull();
  });

  it('should print a sub-point move of the susceptibility at one decimal', async () => {
    // The fixture prices 35.5% of a loss event; scaling every outcome by 1.02 lifts it to 36.2%, which whole points print as 0.
    const previous = run({ createdAt: new Date(Date.now() - DAY_MS).toISOString() });
    const latest = run({ outcomeEvicted: 0.204, outcomeImpactDetected: 0.306, outcomeImpactUndetected: 0.102 });
    await renderCard([latest, previous]);
    expect(within(factorPaper('Effective susceptibility')).getByText(/pts$/).textContent).toBe('+0.7 pts');
  });

  it('should open what changed from the loss, a button and each factor once there are two runs', async () => {
    await renderCard([run(), run({ createdAt: new Date(Date.now() - DAY_MS).toISOString() })]);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/tenant-1/risk-scenarios/scenario-1/changes?tab=ale',
      '/tenant-1/risk-scenarios/scenario-1/changes?tab=ale',
      '/tenant-1/risk-scenarios/scenario-1/changes?tab=tef',
      '/tenant-1/risk-scenarios/scenario-1/changes?tab=susceptibility',
      '/tenant-1/risk-scenarios/scenario-1/changes?tab=magnitude',
    ]);
  });

  it('should offer no comparison for a single run', async () => {
    await renderCard([run()]);
    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});
