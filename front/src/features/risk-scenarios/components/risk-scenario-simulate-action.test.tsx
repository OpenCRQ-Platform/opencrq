/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { RiskScenarioSimulateAction } from './risk-scenario-simulate-action';

// The real score function stays: which threat the action opens is what this guards.
vi.mock('../../threats', async () => {
  const utils = await import('../../threats/components/relevance-proof-utils');
  return { composeThreatScore: utils.composeThreatScore };
});

const SCENARIO_ID = '00000000-0000-0000-0000-0000000000a1';

const threat = (name: string, combinedRelevance: number, activityWeight: number) => ({
  id: name,
  stixId: `intrusion-set--${name.toLowerCase()}`,
  name,
  entityType: 'intrusion-set',
  activityScore: activityWeight,
  activityWeight,
  lastObservedAt: null,
  combinedRelevance,
  resourceLevel: null,
  countries: [],
  sectors: [],
  matchedCountry: null,
  matchedSector: null,
});

const scenarioOf = (name: string, product = 'openaev') => ({
  key: `intrusion-set--${name.toLowerCase()}`,
  product,
  objectId: `s-${name}`,
  objectType: 'scenario',
  objectName: `${name} scenario`,
  objectUrl: `https://${product}.example/admin/scenarios/s-${name}`,
  facts: [],
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});
afterEach(() => cleanup());

const render = (items: Array<unknown>, counterparts: Array<unknown>) => renderWithTrpc(
  <RiskScenarioSimulateAction riskScenarioId={SCENARIO_ID} />,
  { answers: { 'threats.getRelevantForScenario': { items }, 'xtm.counterparts': { counterparts, unavailable: [] } } },
);

describe('RiskScenarioSimulateAction', () => {
  it('opens the OpenAEV scenario of the most relevant threat OpenAEV holds', async () => {
    render(
      [threat('Low', 0.2, 0.2), threat('High', 0.9, 0.9), threat('Unsimulated', 1, 1)],
      [scenarioOf('Low'), scenarioOf('High'), scenarioOf('Unsimulated', 'opencti')],
    );
    const link = await screen.findByRole('link', { name: 'Simulate in OpenAEV' });
    expect(link.getAttribute('href')).toBe('https://openaev.example/admin/scenarios/s-High');
    expect(link.getAttribute('target')).toBe('_blank');
    // The hint is the design system tooltip, never a native title.
    expect(link.getAttribute('title')).toBeNull();
    act(() => link.focus());
    expect((await screen.findAllByText('Open the OpenAEV scenario of High')).length).toBeGreaterThan(0);
  });

  it('renders nothing when OpenAEV holds none of the relevant threats', async () => {
    const { container } = render([threat('High', 0.9, 0.9)], [scenarioOf('High', 'opencti')]);
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(screen.queryByRole('link')).toBeNull();
  });
});
