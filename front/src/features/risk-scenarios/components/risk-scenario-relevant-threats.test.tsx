/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { RiskScenarioRelevantThreats } from './risk-scenario-relevant-threats';

// The real score functions stay: what the Score and Relevance columns sort on is what this guards.
vi.mock('../../threats', async () => {
  const utils = await import('../../threats/components/relevance-proof-utils');
  return {
    composeThreatScore: utils.composeThreatScore,
    threatScoreSortKey: utils.threatScoreSortKey,
    observedAtSortValue: () => undefined,
    ActivityGradeBadge: () => null,
    DimensionTags: () => null,
    RelevanceBand: () => null,
    RelevanceProofPanel: () => null,
    ResourceLevelValue: () => null,
    ThreatTypeBadge: () => null,
  };
});

vi.mock('../../../components/shared', () => ({
  SectionCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

vi.mock('../../finding-score', () => ({
  ScoreGaugeMark: ({ score }: { score: number }) => <span>{`score ${score}`}</span>,
  severityBandLabel: (band: string) => band,
}));

vi.mock('../../threat-relevance-settings', () => ({
  confidenceGateLevelLabel: () => 'High',
}));

vi.mock('./admission-rule-sentence', () => ({
  AdmissionRuleSentence: () => null,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<object>(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const row = (name: string, combinedRelevance: number, activityWeight: number) => ({
  id: name,
  stixId: `intrusion-set--${name.replace(' ', '-').toLowerCase()}`,
  name,
  entityType: 'intrusion-set',
  activityScore: activityWeight,
  activityWeight,
  lastObservedAt: '2026-01-01T00:00:00.000Z',
  combinedRelevance,
  resourceLevel: null,
  countries: [],
  sectors: [],
  matchedCountry: null,
  matchedSector: null,
});

// Both products display as 15, but 0.152 is above 0.148, while 0.8 is above 0.5 in relevance. The
// rounded-score tie keeps the arrival order, which is the reverse of the product order.
const LOWER_PRODUCT = row('Lower product', 0.8, 0.185);
const HIGHER_PRODUCT = row('Higher product', 0.5, 0.304);

const names = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody > tr'))
  .map((tr) => tr.querySelector('td')?.textContent);

const renderTable = async (storageSuffix: string, counterparts: Array<object> = []) => {
  // The table id is shared, so a sorting persisted by one test must not reach the next.
  localStorage.clear();
  const { container } = renderWithTrpc(
    <RiskScenarioRelevantThreats riskScenarioId={`scenario-${storageSuffix}`} riskScenarioName="Ransomware" />,
    {
      answers: {
        'threats.getRelevantForScenario': { items: [LOWER_PRODUCT, HIGHER_PRODUCT], belowGateClaimCount: 0 },
        'threats.hasAny': true,
        'xtm.counterparts': counterparts,
      },
    },
  );
  await waitFor(() => expect(names(container)).toHaveLength(2));
  return container;
};

describe('RiskScenarioRelevantThreats sorting', () => {
  it('should show both threats at the same rounded score', async () => {
    const container = await renderTable('rounded');

    expect(container.textContent?.match(/score 15/g)).toHaveLength(2);
  });

  it('should sort the Score column on the unrounded product, in both directions', async () => {
    const container = await renderTable('score');

    expect(names(container)).toEqual(['Higher product', 'Lower product']);

    fireEvent.click(screen.getByText('Score'));
    expect(names(container)).toEqual(['Lower product', 'Higher product']);

    // A third click on the header leaves the sort (second click) and starts again descending.
    fireEvent.click(screen.getByText('Score'));
    fireEvent.click(screen.getByText('Score'));
    expect(names(container)).toEqual(['Higher product', 'Lower product']);
  });

  it('should sort on the Relevance column', async () => {
    const container = await renderTable('relevance');

    fireEvent.click(screen.getByText('Relevance'));
    const first = names(container);
    fireEvent.click(screen.getByText('Relevance'));
    const second = names(container);

    expect(first).toEqual(['Lower product', 'Higher product']);
    expect(second).toEqual(['Higher product', 'Lower product']);
  });
});

describe('RiskScenarioRelevantThreats pivots', () => {
  it('should mark a threat OpenAEV holds, and only that one', async () => {
    const container = await renderTable('pivots', [{
      key: 'intrusion-set--higher-product',
      product: 'openaev',
      objectId: 'oaev-1',
      objectType: 'Scenario',
      objectName: 'Higher product scenario',
      objectUrl: 'https://openaev.example/scenarios/oaev-1',
      facts: [],
    }]);

    await waitFor(() => expect(container.querySelectorAll('a[href^="https://openaev.example"]')).toHaveLength(1));
    const link = container.querySelector('a[href^="https://openaev.example"]');
    expect(link?.getAttribute('aria-label')).toBe('Open in OpenAEV');
    expect(link?.closest('tr')?.querySelector('td')?.textContent).toBe('Higher product');
  });

  it('should show no mark when no product holds the threats', async () => {
    const container = await renderTable('no-pivots');

    expect(container.querySelector('a[aria-label^="Open in"]')).toBeNull();
  });
});
