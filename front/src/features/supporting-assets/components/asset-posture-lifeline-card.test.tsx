/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PostureHistoryLine } from '../posture-lifeline-utils';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<object>(),
  Link: ({ params, children }: { params: { supportingAssetId: string }, children: ReactNode }) => (
    <a href={`/assets/${params.supportingAssetId}/events`}>{children}</a>
  ),
}));

const { AssetPostureLifelineCard } = await import('./asset-posture-lifeline-card');

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const DAY_MS = 86_400_000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

const cause = (name: string, change: NonNullable<PostureHistoryLine['cause']>['change']): PostureHistoryLine['cause'] => ({
  worstFinding: { evidenceId: name, name },
  worstExploitability: 40,
  countsByBand: { critical: 0, high: 1, medium: 0, low: 0 },
  change,
});

const lines: Array<PostureHistoryLine> = [
  { at: daysAgo(10), score: 70, cause: cause('CVE-2026-0001', { kind: 'first' }) },
  { at: daysAgo(5), score: 55, cause: cause('CVE-2026-0002', { kind: 'newWorst' }) },
];

describe('AssetPostureLifelineCard', () => {
  it('should announce the mark the arrow keys move to', () => {
    render(
      <I18nProvider i18n={i18n}>
        <AssetPostureLifelineCard tenantId="tenant" supportingAssetId="asset" lines={lines} isError={false} />
      </I18nProvider>,
    );
    const plot = screen.getByRole('group');

    fireEvent.focus(plot);
    expect(screen.getByRole('status').textContent).toContain('New worst finding: CVE-2026-0002');

    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(screen.getByRole('status').textContent).toContain('First posture. Worst finding: CVE-2026-0001');
  });

  it('should link to the asset events tab', () => {
    render(
      <I18nProvider i18n={i18n}>
        <AssetPostureLifelineCard tenantId="tenant" supportingAssetId="asset" lines={[]} isError={false} />
      </I18nProvider>,
    );

    expect(screen.getByRole('link', { name: 'View events' }).getAttribute('href')).toBe('/assets/asset/events');
  });

  it('should say the history could not be loaded rather than that none was recorded', () => {
    render(
      <I18nProvider i18n={i18n}>
        <AssetPostureLifelineCard tenantId="tenant" supportingAssetId="asset" lines={undefined} isError />
      </I18nProvider>,
    );

    expect(screen.getByText('The posture history could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('No OpenCRQ Posture recorded over this period.')).toBeNull();
  });
});
