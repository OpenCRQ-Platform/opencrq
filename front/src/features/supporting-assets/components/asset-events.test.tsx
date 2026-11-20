/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PostureHistoryLine } from '../posture-lifeline-utils';
import { FAILED, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { AssetEvents } from './asset-events';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<object>(),
  Link: ({ params, children }: { params: { evidenceId: string }, children: ReactNode }) => (
    <a href={`/findings/${params.evidenceId}`}>{children}</a>
  ),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const DAY_MS = 86_400_000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

const cause = (evidenceId: string, exploitability: number, change: NonNullable<PostureHistoryLine['cause']>['change']): PostureHistoryLine['cause'] => ({
  worstFinding: { evidenceId, name: `CVE-2026-000${evidenceId}` },
  worstExploitability: exploitability,
  countsByBand: { critical: 0, high: 0, medium: 1, low: 1 },
  change,
});

const renderWith = (answer: Array<PostureHistoryLine> | typeof FAILED) => {
  renderWithTrpc(<AssetEvents tenantId="tenant" supportingAssetId="asset" />, {
    answers: { 'findingScore.getAssetPostureHistory': answer },
  });
};

describe('AssetEvents', () => {
  it('should list each change newest first, a lost and a first posture as rows of their own', async () => {
    renderWith([
      { at: daysAgo(40), score: 48, cause: cause('1', 51, { kind: 'first' }) },
      { at: daysAgo(30), score: null, cause: null },
      { at: daysAgo(20), score: 55, cause: cause('2', 44, { kind: 'regained' }) },
      { at: daysAgo(10), score: 58, cause: cause('3', 41, { kind: 'resolved', resolvedName: 'CVE-2026-0002' }) },
    ]);

    const rows = (await screen.findAllByRole('row')).map((row) => row.textContent).filter((text) => text !== '');
    expect(rows[0]).toContain('Posture changed from 55 to 58.');
    expect(rows[0]).toContain('+3 pts');
    expect(rows[0]).toContain('CVE-2026-0002 resolved. Worst finding: CVE-2026-0003, exploitability 41.');
    expect(rows[1]).toContain('Posture regained at 55.');
    expect(rows[2]).toContain('Posture lost.');
    expect(rows[2]).toContain('No applicable finding left: CVE-2026-0001 resolved.');
    expect(rows[3]).toContain('First posture: 48.');
    expect(rows[3]).toContain('Worst finding: CVE-2026-0001, exploitability 51.');
  });

  it('should open a change with the posture before and after, and each finding in cause linked to its page', async () => {
    renderWith([
      { at: daysAgo(20), score: 55, cause: cause('2', 44, { kind: 'first' }) },
      { at: daysAgo(10), score: 58, cause: cause('3', 41, { kind: 'resolved', resolvedName: 'CVE-2026-0002' }) },
    ]);

    fireEvent.click(await screen.findByText('Posture changed from 55 to 58.'));
    const drawer = screen.getByRole('dialog');

    expect(within(drawer).getByText('Before')).toBeTruthy();
    expect(within(drawer).getByText('After')).toBeTruthy();
    expect(drawer.textContent).toContain('Set by CVE-2026-0002, the worst of 2 applicable findings.');
    expect(drawer.textContent).toContain('Set by CVE-2026-0003, the worst of 2 applicable findings.');
    expect(within(drawer).getByRole('link', { name: 'CVE-2026-0002' }).getAttribute('href')).toBe('/findings/2');
    expect(within(drawer).getByRole('link', { name: 'CVE-2026-0003' }).getAttribute('href')).toBe('/findings/3');
    expect(within(drawer).getByText('Resolved')).toBeTruthy();
    expect(within(drawer).getByText('New worst')).toBeTruthy();
  });

  it('should open a first posture with no before', async () => {
    renderWith([{ at: daysAgo(10), score: 48, cause: cause('1', 51, { kind: 'first' }) }]);

    fireEvent.click(await screen.findByText('First posture: 48.'));

    expect(within(screen.getByRole('dialog')).queryByText('Before')).toBeNull();
  });

  it('should say there is no history for an asset with no journal line', async () => {
    renderWith([]);

    expect(await screen.findByText('No history yet.')).toBeTruthy();
  });

  it('should say the history could not be loaded rather than that there is none', async () => {
    renderWith(FAILED);

    expect(await screen.findByText('The posture history could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('No history yet.')).toBeNull();
  });
});
