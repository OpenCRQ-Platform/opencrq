/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreatAnalysisDetailData } from './threat-detail-tabs';
import { messages as frenchMessages } from '../../../locales/fr/messages.po';
import { FAILED, NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ThreatHero } from './threat-hero';

const useOpenCtiBaseUrl = vi.fn<() => string | null>();
vi.mock('../../../hooks', () => ({
  useOpenCtiBaseUrl: () => useOpenCtiBaseUrl(),
}));
vi.mock('../../../hooks/utils/use-has-manage-security', () => ({ useHasManageSecurity: () => false }));

vi.mock('./threat-actions-menu', () => ({
  ThreatActionsMenu: ({ threatId }: { threatId: string }) => <button type="button" data-threat-id={threatId}>Threat actions</button>,
}));

vi.mock('./threat-quantify-action', () => ({
  ThreatQuantifyAction: ({ attackOutcomeId }: { attackOutcomeId: string }) => <button type="button" data-outcome-id={attackOutcomeId}>Quantify risk</button>,
}));

const STIX_ID = 'intrusion-set--11111111-1111-1111-1111-111111111111';
const DAY_MS = 86_400_000;

const detail = (overrides: { kind: 'connector' | 'stix-import', lastObservedAt?: string | null, resourceLevel?: string | null }): ThreatAnalysisDetailData => ({
  analysis: {
    id: '0190a000-0000-7000-8000-000000000001',
    stixId: STIX_ID,
    entityType: 'intrusion-set',
    name: 'APT28',
    description: 'Never shown in the header.',
    mitreGroupId: 'G0007',
    confidence: 85,
    stixCreated: null,
    firstSeen: null,
    lastSeen: null,
    primaryMotivation: null,
    resourceLevel: overrides.resourceLevel === undefined ? 'government' : overrides.resourceLevel,
    sophistication: null,
    objective: null,
  },
  attributedTo: [],
  attributedFrom: [],
  threatActorTypes: [],
  roles: [],
  origin: { kind: overrides.kind, stixId: STIX_ID, lastIngestedAt: '2026-01-01T00:00:00Z' },
  activity: {
    activityScore: 0,
    lastObservedAt: overrides.lastObservedAt === undefined ? new Date(Date.now() - 5 * DAY_MS).toISOString() : overrides.lastObservedAt,
    lastObservedVia: null,
  },
  locations: [
    { id: 'l1', stixId: 'location--1', name: 'France', country: 'France', countryId: 'c1', countryIsoAlpha2: 'FR', matchesOrganization: true, openctiStixRelationId: null },
    { id: 'l2', stixId: 'location--2', name: 'Germany', country: 'Germany', countryId: 'c2', countryIsoAlpha2: 'DE', matchesOrganization: false, openctiStixRelationId: null },
  ],
  sectors: [
    { id: 's1', stixId: 'identity--1', name: 'Finance', sectorId: 's1', matchesOrganization: true, openctiStixRelationId: null },
  ],
  cves: [],
  techniques: [],
  declaredIntent: { primaryMotivations: [], secondaryMotivations: [], goals: [] },
});

beforeAll(() => {
  i18n.load('en', {});
});

beforeEach(() => {
  i18n.activate('en');
  useOpenCtiBaseUrl.mockReturnValue('https://opencti.example.com');
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

const OUTCOME_SCORES = [
  { attackOutcomeId: 'o1', outcomeName: 'Ransomware', score: 0.41 },
  { attackOutcomeId: 'o2', outcomeName: 'Customer data exfiltration', score: 0.82 },
];

const renderHero = (data: ThreatAnalysisDetailData, scores: unknown = OUTCOME_SCORES) => renderWithTrpc(<ThreatHero detail={data} />, {
  answers: { 'threats.getOutcomeScoresForAnalysis': scores },
});

describe('ThreatHero', () => {
  it('heads the page with the threat name, its type and its MITRE group id', () => {
    renderHero(detail({ kind: 'connector' }));

    expect(screen.getByRole('heading', { level: 1, name: 'APT28' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'APT28' })).toBeTruthy();
    expect(screen.getByText('Intrusion set')).toBeTruthy();
    expect(screen.getByText('G0007')).toBeTruthy();
    expect(screen.queryByText('Never shown in the header.')).toBeNull();
    expect(screen.queryByText('85%')).toBeNull();
  });

  it('opens a connector threat in OpenCTI from the single icon-only XTM One emblem and offers no delete menu', async () => {
    renderHero(detail({ kind: 'connector' }));

    const emblem = await screen.findByTestId('xtm-emblem');
    expect(emblem.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Threat actions' })).toBeNull();
    fireEvent.click(emblem);
    const surface = await screen.findByTestId('xtm-surface');
    const link = within(surface).getByRole('link', { name: 'Open in OpenCTI' });
    expect(link.getAttribute('href')).toBe(`https://opencti.example.com/dashboard/id/${STIX_ID}`);
  });

  it('gives a STIX import the delete menu and no active OpenCTI emblem', () => {
    renderHero(detail({ kind: 'stix-import' }));

    expect(screen.getByRole('button', { name: 'Threat actions' })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps the OpenCTI emblem greyed when no platform is configured', () => {
    useOpenCtiBaseUrl.mockReturnValue(null);
    renderHero(detail({ kind: 'connector' }));

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the four key figures', async () => {
    renderHero(detail({ kind: 'connector' }));

    expect(await screen.findByText('82%')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText(/^Last activity observed: /)).toBeTruthy();
    expect(screen.getByText('Best match: Customer data exfiltration')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('countries and sectors concern you')).toBeTruthy();
    expect(screen.getByText('Government')).toBeTruthy();
    expect(screen.getByText('Resource level')).toBeTruthy();
  });

  it('offers to quantify the threat on its best matching outcome', async () => {
    renderHero(detail({ kind: 'connector' }));

    const quantify = await screen.findByRole('button', { name: 'Quantify risk' });
    expect(quantify.getAttribute('data-outcome-id')).toBe('o2');
  });

  it('offers no quantify action when no outcome matches', async () => {
    renderHero(detail({ kind: 'stix-import' }), [{ attackOutcomeId: 'o1', outcomeName: 'Ransomware', score: 0 }]);

    await screen.findByText('No matching attack outcome');
    expect(screen.queryByRole('button', { name: 'Quantify risk' })).toBeNull();
  });

  it('words the level once for assistive technology, the gauge being decorative', () => {
    renderHero(detail({ kind: 'connector' }));

    expect(screen.queryByRole('img', { name: 'Government' })).toBeNull();
  });

  it('says when a threat is dormant, undated or matches no outcome', async () => {
    const noMatch = [{ attackOutcomeId: 'o1', outcomeName: 'Ransomware', score: 0 }];
    const { unmount } = renderHero(
      detail({ kind: 'stix-import', lastObservedAt: new Date(Date.now() - 400 * DAY_MS).toISOString(), resourceLevel: null }),
      noMatch,
    );

    expect(await screen.findByText('No matching attack outcome')).toBeTruthy();
    expect(screen.getByText('Dormant')).toBeTruthy();
    unmount();

    renderHero(detail({ kind: 'stix-import', lastObservedAt: null }), noMatch);
    expect(await screen.findByText('Not dated')).toBeTruthy();
    expect(screen.getByText('Observed activity')).toBeTruthy();
  });

  it.each([
    ['loading', NEVER],
    ['failed', FAILED],
  ])('shows the outcome figure as unknown while its scores are %s', async (_state, answer) => {
    const { queryClient } = renderHero(detail({ kind: 'connector' }), answer);
    if (answer === FAILED) {
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    }

    const label = await screen.findByText('Attack outcomes');
    expect(label.parentElement?.textContent).toBe('-Attack outcomes');
    expect(screen.queryByText('No matching attack outcome')).toBeNull();
  });

  it('keeps the last known scores when a refetch fails', async () => {
    let reads = 0;
    const { calls, queryClient } = renderHero(detail({ kind: 'connector' }), () => {
      reads += 1;
      if (reads > 1) {
        throw new Error('refetch failed');
      }
      return [{ attackOutcomeId: 'o2', outcomeName: 'Customer data exfiltration', score: 0.82 }];
    });
    await screen.findByText('82%');

    // A window focus refetches the stale scores, and the fake server now fails.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(calls.filter((c) => c.path === 'threats.getOutcomeScoresForAnalysis')).toHaveLength(2));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('Best match: Customer data exfiltration')).toBeTruthy();
    expect(screen.queryByText('Attack outcomes')).toBeNull();
  });

  it('translates the figures in French', async () => {
    i18n.load('fr', frenchMessages);
    i18n.activate('fr');
    renderHero(detail({ kind: 'connector' }));

    // The default text normalizer folds the narrow no-break space French puts before "%" into a space.
    expect(await screen.findByText('82 %')).toBeTruthy();
    expect(screen.getByText('Issue la plus proche : Customer data exfiltration')).toBeTruthy();
    expect(screen.getByText('Gouvernement')).toBeTruthy();
    expect(screen.getByText('Niveau de ressources')).toBeTruthy();
  });
});
