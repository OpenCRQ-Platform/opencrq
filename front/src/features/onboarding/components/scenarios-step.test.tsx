/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ScenariosStep } from './scenarios-step';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#step">{children}</a>,
  useMatches: () => [],
  useParams: () => ({ tenantId: '89c70e9a-8317-4da7-8765-1b9ba004c32c' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const RANSOMWARE = 'd1a1dbbe-de60-51d6-b7c2-53c0b213dbd7';
const THEFT = 'e525353b-083b-50a9-898d-e4e751601417';
const ESPIONAGE = '3035898b-f4e7-5da9-bf9c-992d671ab7b0';
const OPS = '00000000-0000-4000-8000-000000000003';
const PERSONAL = '00000000-0000-4000-8000-000000000001';

const OUTCOMES = [
  { id: RANSOMWARE, name: 'Ransomware', description: null },
  { id: THEFT, name: 'Data Theft Extortion', description: null },
  { id: ESPIONAGE, name: 'Espionage', description: null },
];

const COMPATIBLE: Record<string, Array<string>> = {
  [RANSOMWARE]: [OPS, PERSONAL],
  [THEFT]: [PERSONAL],
  [ESPIONAGE]: [OPS],
};

const WIZARD = {
  id: 'wizard-id',
  organizationId: 'scope-id',
  steps: {
    company: 'done', assets: 'done', threats: 'done', defenses: 'done', finances: 'done', tolerance: 'done', protect: 'done', scenarios: 'todo',
  },
  finished: false,
};

const CUSTOMERS = { id: 'asset-customers', name: 'Customers', businessValueCategories: [{ id: PERSONAL, code: 'personal-data', name: 'Personal data' }] };

const READY = { status: 'ready', missing: [], outdated: [] };

const scenarioRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'scenario-1',
  organizationId: 'scope-id',
  name: 'Ransomware · Ledger',
  description: null,
  organization: null,
  attackOutcome: { id: RANSOMWARE, name: 'Ransomware' },
  primaryAssets: [{ id: 'asset-customers', name: 'Customers' }],
  owner: null,
  noMappedAsset: false,
  latestRun: { runId: 'run-1', createdAt: new Date(), aleMean: 730_000, aleP10: 500_000, aleP90: 900_000, lefMean: 0.1, techniqueCount: 4, coveredTechniqueCount: 1 },
  lifeline: [],
  changeOverLifeline: null,
  readiness: READY,
  ...overrides,
});

interface Setup {
  assets?: Array<{ id: string, name: string, businessValueCategories: Array<{ id: string, code: string, name: string }> }>,
  scenarios?: Array<ReturnType<typeof scenarioRow>>,
  pending?: boolean,
}

const renderStep = ({ assets = [], scenarios = [], pending = false }: Setup = {}) => renderWithTrpc(<ScenariosStep />, {
  answers: {
    'onboardingWizard.getOnboardingWizard': WIZARD,
    'attackOutcomes.getAttackOutcomes': OUTCOMES,
    'primaryAssets.getPrimaryAssets': assets,
    'riskScenarios.getRiskScenariosOverview': scenarios,
    'lossDrivers.getCompatibleBusinessValueCategoryIds': (input: { attackOutcomeId: string }) => COMPATIBLE[input.attackOutcomeId] ?? [],
    'crqIndicators.getPendingComputation': { pending },
  },
});

describe('ScenariosStep', () => {
  it('says scenarios need a primary asset, with a link to Protect, and offers nothing to create', async () => {
    renderStep();

    expect(await screen.findByText(/Scenarios need a primary asset/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Protect step' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ransomware' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create and compute' })).toBeNull();
    expect(screen.queryByText('Whole company')).toBeNull();
  });

  it('still lists the scenarios of a scope with no primary asset, next to the Protect link', async () => {
    renderStep({ scenarios: [scenarioRow()] });

    expect(await screen.findByText('$730K')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Protect step' })).toBeTruthy();
  });

  it('names each suggestion after the primary assets its outcome reaches', async () => {
    renderStep({
      assets: [
        { id: 'asset-ledger', name: 'Ledger', businessValueCategories: [{ id: OPS, code: 'operations-and-services', name: 'Operations and services' }] },
        { id: 'asset-customers', name: 'Customers', businessValueCategories: [{ id: PERSONAL, code: 'personal-data', name: 'Personal data' }] },
      ],
    });

    expect(await screen.findByText('Ledger, Customers')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ransomware' })).toBeTruthy();
    expect(screen.getByText('Customers')).toBeTruthy();
    expect(screen.getByText('Ledger')).toBeTruthy();
  });

  it('creates the checked scenarios on the primary assets, their creation booking the simulation', async () => {
    const { calls } = renderStep({
      assets: [CUSTOMERS],
    });
    await screen.findByRole('button', { name: 'Ransomware' });

    fireEvent.click(screen.getByRole('button', { name: 'Create and compute' }));

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.path === 'riskScenarios.createRiskScenario')).toHaveLength(2);
    });
    expect(calls.find((call) => call.path === 'riskScenarios.createRiskScenario')?.input).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      organizationId: 'scope-id',
      name: 'Ransomware · Customers',
      description: null,
      attackOutcomeId: RANSOMWARE,
      primaryAssetIds: ['asset-customers'],
    });
    expect(calls.some((call) => call.path === 'crqIndicators.enqueueSimulation')).toBe(false);
  });

  it('shows a created scenario with its figure and does not suggest it again', async () => {
    renderStep({ assets: [CUSTOMERS], scenarios: [scenarioRow()] });

    expect(await screen.findByText('$730K')).toBeTruthy();
    expect(screen.getByText('p10 $500K - p90 $900K')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ransomware' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Data theft extortion' })).toBeTruthy();
  });

  it('links to the risk scenarios page next to the scope\'s scenarios, and only once it has some', async () => {
    renderStep({ assets: [CUSTOMERS], scenarios: [scenarioRow()] });

    expect(await screen.findByRole('link', { name: 'See all risk scenarios' })).toBeTruthy();
    cleanup();
    renderStep({ assets: [CUSTOMERS], scenarios: [] });
    await screen.findByRole('button', { name: 'Ransomware' });
    expect(screen.queryByRole('link', { name: 'See all risk scenarios' })).toBeNull();
  });

  it('says a scenario with no figure is computing while a computation is pending, whatever its readiness says', async () => {
    renderStep({ scenarios: [scenarioRow({ latestRun: null, readiness: { status: 'incomplete', missing: ['tef'], outdated: [] } })], pending: true });

    expect(await screen.findByText('Computing…')).toBeTruthy();
    expect(screen.queryByText('Incomplete')).toBeNull();
    expect(screen.queryByText('Complete Threats')).toBeNull();
  });

  it('asks whether a computation is pending for the scenario only while it has no figure', async () => {
    const { calls } = renderStep({ scenarios: [scenarioRow()] });
    await screen.findByText('Expected annual loss');

    expect(calls.some((call) => call.path === 'crqIndicators.getPendingComputation')).toBe(false);
  });

  it('sends a scenario waiting on threats back to the Threats step', async () => {
    renderStep({ scenarios: [scenarioRow({ latestRun: null, readiness: { status: 'incomplete', missing: ['tef'], outdated: [] } })] });

    expect(await screen.findByText('Incomplete')).toBeTruthy();
    expect(screen.getByText('Complete Threats')).toBeTruthy();
  });

  it('sends a scenario waiting on the financial profile back to the Finances step', async () => {
    renderStep({ scenarios: [scenarioRow({ latestRun: null, readiness: { status: 'incomplete', missing: ['loss-drivers'], outdated: [] } })] });

    expect(await screen.findByText('Complete Finances')).toBeTruthy();
  });

  it('sends a scenario of a scope that maps nothing back to the Assets step', async () => {
    renderStep({ scenarios: [scenarioRow({ noMappedAsset: true, readiness: { status: 'no-mapped-asset', missing: [], outdated: [] } })] });

    expect(await screen.findByText('No mapped asset')).toBeTruthy();
    expect(screen.getByText('Complete Assets')).toBeTruthy();
  });
});
