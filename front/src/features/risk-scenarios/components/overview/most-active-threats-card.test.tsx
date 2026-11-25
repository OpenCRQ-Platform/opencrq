/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NEVER, renderWithTrpc } from '../../../../providers/trpc-test-harness';
import { MostActiveThreatsCard } from './most-active-threats-card';

vi.mock('../../../../components/shared', () => ({
  SectionCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

vi.mock('../../../threats', () => ({
  ActivityGradeBadge: ({ lastObservedAt }: { lastObservedAt: string | null }) => <span>{lastObservedAt === null ? 'Not dated' : 'Dated'}</span>,
  HiddenThreatsAlert: () => null,
  ThreatTypeBadge: () => null,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const item = (name: string, activityScore: number | null, combinedRelevance = 0.5) => ({
  id: name,
  name,
  entityType: 'intrusion-set',
  activityScore,
  lastObservedAt: activityScore === null ? null : '2026-01-01T00:00:00.000Z',
  combinedRelevance,
});

const renderWith = (answer: unknown) => {
  renderWithTrpc(<MostActiveThreatsCard riskScenarioId="00000000-0000-0000-0000-0000000000c1" />, {
    answers: { 'threats.getRelevantForScenario': answer },
  });
};

describe('MostActiveThreatsCard', () => {
  it('should say no relevant threat was identified when the scenario admits none', async () => {
    renderWith({ items: [] });

    expect(await screen.findByText('No relevant threats identified yet.')).toBeTruthy();
    expect(screen.queryByText('No relevant threat has a dated activity yet.')).toBeNull();
  });

  it('should say no threat has a dated activity rather than list threats whose activity is unknown', async () => {
    renderWith({ items: [item('Unknown A', null, 0.9), item('Unknown B', null)] });

    expect(await screen.findByText('No relevant threat has a dated activity yet.')).toBeTruthy();
    expect(screen.queryByText('Unknown A')).toBeNull();
    expect(screen.queryByText('No relevant threats identified yet.')).toBeNull();
  });

  it('should list only the dated threats, the most active first, and none whose activity is unknown', async () => {
    renderWith({
      items: [
        item('Unknown crew A', null, 1),
        item('Quiet crew', 0.1),
        item('Unknown crew B', null, 0.9),
        item('Loud crew', 0.9),
        item('Unknown crew C', null),
        item('Unknown crew D', null),
      ],
    });

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Loud crew'),
      expect.stringContaining('Quiet crew'),
    ]);
    expect(screen.queryByText(/Unknown crew/)).toBeNull();
    expect(screen.queryByText('Not dated')).toBeNull();
  });

  it('should show neither message nor rows while the threats load', () => {
    renderWith(NEVER);

    expect(screen.queryByText('No relevant threats identified yet.')).toBeNull();
    expect(screen.queryByText('No relevant threat has a dated activity yet.')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
