/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { LossEstimatesDrawer } from './loss-estimates-drawer';

const DRIVER = {
  id: '00000000-0000-0000-0000-0000000000d1',
  name: 'Incident response',
  description: null,
  lossCategoryId: '00000000-0000-0000-0000-0000000000c1',
  lossCategoryName: 'Response',
  lossCategoryDisplayOrder: 0,
};

const estimate = (minValue: number, updatedAt: string) => ({
  lossDriverId: DRIVER.id,
  minValue,
  likelyValue: 200,
  maxValue: 300,
  provenance: 'manual',
  isPosture: false,
  lowConfidence: false,
  updatedAt,
});

let storedEstimates = [estimate(100, '2026-10-01T10:00:00.000Z')];
// What the doorbell does to the open drawer: the stored estimates query refetches under it. A window
// focus refetches every stale active query, and the fake server then answers with `storedEstimates`.
const refetchStoredEstimates = (next: typeof storedEstimates) => {
  storedEstimates = next;
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
};

vi.mock('@filigran/ui', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useToast: () => ({ toast: () => {} }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  storedEstimates = [estimate(100, '2026-10-01T10:00:00.000Z')];
});

const renderDrawer = () => renderWithTrpc(
  <LossEstimatesDrawer open onClose={() => {}} riskScenarioId="00000000-0000-0000-0000-0000000000s1" focusLossDriverId={null} />,
  {
    answers: {
      'lossDrivers.getLossDrivers': [DRIVER],
      'lossDrivers.getScenarioDriverRecommendation': { compatibleCellCount: 0, recommendations: [] },
      'scenarioLossEstimates.getScenarioLossEstimates': () => storedEstimates,
      'scenarioLossEstimates.getAutomaticEstimates': [],
    },
  },
);

const min = () => screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Min ($)' });

describe('LossEstimatesDrawer', () => {
  it('shows the server version of a row both sides changed, and takes it on demand', async () => {
    renderDrawer();
    await screen.findByRole('spinbutton', { name: 'Min ($)' });
    fireEvent.change(min(), { target: { value: '150' } });

    refetchStoredEstimates([estimate(110, '2026-10-02T10:00:00.000Z')]);

    await waitFor(() => expect(screen.getByRole('note').textContent).toContain('$110'));
    expect(min().value).toBe('150');

    fireEvent.click(screen.getByRole('button', { name: 'Use saved value' }));
    expect(min().value).toBe('110');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('takes the server version of a row the analyst left untouched, with no note', async () => {
    renderDrawer();
    await screen.findByRole('spinbutton', { name: 'Min ($)' });

    refetchStoredEstimates([estimate(110, '2026-10-02T10:00:00.000Z')]);
    await waitFor(() => expect(min().value).toBe('110'));
    expect(screen.queryByRole('note')).toBeNull();
  });
});
