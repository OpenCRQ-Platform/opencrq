/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { DrataTile, SelfAssessmentTile } from './defense-source-tiles';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#integrations">{children}</a>,
  useMatches: () => [],
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const assessment = (strengthMode: 'auto' | 'manual', coverageMode: 'auto' | 'manual') => ({
  strengthRung: 'L2',
  coverageBucket: 'L2',
  strengthMode,
  coverageMode,
  coverageBasis: 'declared',
  comment: null,
});

const capability = (id: string, assessed: ReturnType<typeof assessment> | null = null) => ({
  id,
  externalId: id.toUpperCase(),
  name: `Control ${id}`,
  description: '',
  domain: 'network',
  position: 1,
  assessment: assessed,
  lastAssessedAt: null,
  lastAssessedBy: null,
  lastAssessedConnector: null,
});

describe('DrataTile', () => {
  const renderDrata = (activeRun: { processedTotal: number, expectedTotal: number | null } | null) => renderWithTrpc(<DrataTile tenantId="tenant-id" />, {
    answers: {
      'connectors.listConnectors': [{ source: 'drata', state: activeRun === null ? 'healthy' : 'syncing', enabled: true, activeRun }],
      'connectors.getConnector': { platformConfigured: false, tenantConfigured: false, state: 'unavailable', activeRunId: null },
      'controlCapabilities.getControlCapabilities': [capability('a', assessment('auto', 'auto'))],
      'capabilities.hasManageSecurity': true,
    },
  });

  it('shows the connector state and no count, since no read tells which assessments Drata fed', async () => {
    renderDrata(null);

    expect(await screen.findByText('Healthy')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Drata' })).toBeTruthy();
    expect(screen.queryByText(/capabilit/)).toBeNull();
  });

  it('draws the run progress when the run knows its expected total', async () => {
    renderDrata({ processedTotal: 1, expectedTotal: 2 });

    const bar = await screen.findByRole('progressbar', { name: 'Drata import progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('opens a drawer titled with the source on Configure', async () => {
    renderDrata(null);

    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));

    expect(await within(await screen.findByRole('dialog')).findByRole('heading', { name: 'Drata' })).toBeTruthy();
  });
});

describe('SelfAssessmentTile', () => {
  const renderSelf = (capabilities: Array<ReturnType<typeof capability>>) => renderWithTrpc(<SelfAssessmentTile />, {
    answers: { 'controlCapabilities.getControlCapabilities': capabilities },
  });

  it('counts the capabilities assessed by hand, leaving out the derived and the unassessed ones', async () => {
    renderSelf([
      capability('a', assessment('manual', 'manual')),
      capability('b', assessment('auto', 'auto')),
      capability('c'),
      capability('d', assessment('manual', 'auto')),
    ]);

    expect(await screen.findByText('2 capabilities assessed by hand')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('counts a single capability in the singular', async () => {
    renderSelf([capability('a', assessment('manual', 'manual'))]);

    expect(await screen.findByText('1 capability assessed by hand')).toBeTruthy();
  });

  it('shows no chip while nothing is assessed by hand', async () => {
    renderSelf([capability('a')]);

    expect(await screen.findByText('0 capabilities assessed by hand')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('opens the assessment drawer on Assess', async () => {
    renderSelf([capability('a')]);

    fireEvent.click(await screen.findByRole('button', { name: 'Assess' }));

    expect(await within(await screen.findByRole('dialog')).findByRole('heading', { name: 'Assess yourself' })).toBeTruthy();
  });
});
