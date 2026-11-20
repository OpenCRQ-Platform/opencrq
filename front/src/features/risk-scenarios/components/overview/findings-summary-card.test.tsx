/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FAILED, NEVER, renderWithTrpc } from '../../../../providers/trpc-test-harness';
import { FindingsSummaryCard } from './findings-summary-card';

vi.mock('../../../../components/shared', () => ({
  SectionCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

vi.mock('../../../../providers/tenant-provider', () => ({
  useTenant: () => ({ tenantId: '00000000-0000-0000-0000-00000000000f' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderWith = (answer: unknown) => {
  renderWithTrpc(<FindingsSummaryCard riskScenarioId="00000000-0000-0000-0000-0000000000c1" />, {
    answers: { 'riskScenarios.getFindingsSummaryForRiskScenario': answer },
  });
};

const EMPTY_SCENARIO = { counts: { critical: 0, high: 0, medium: 0, low: 0, none: 0, unscored: 0, kev: 0, dismissed: 0, total: 0 }, top: [] };

describe('FindingsSummaryCard', () => {
  it('should say a scenario is clean only once its summary answered with no finding', async () => {
    renderWith(EMPTY_SCENARIO);

    expect(await screen.findByText('No finding affects the assets in this scenario\'s blast radius.')).toBeTruthy();
  });

  it('should wait rather than call the scenario clean while the summary has neither data nor an error', () => {
    renderWith(NEVER);

    expect(screen.queryByText('No finding affects the assets in this scenario\'s blast radius.')).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('should say the findings could not be loaded when the summary failed', async () => {
    renderWith(FAILED);

    expect(await screen.findByText('Findings could not be loaded, so this is not a clean scenario.')).toBeTruthy();
  });
});
