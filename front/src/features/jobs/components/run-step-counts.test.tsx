/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RunStepCounts } from './run-step-counts';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('RunStepCounts', () => {
  it('renders nothing for a run that reports no step counts', () => {
    render(<RunStepCounts stepCounts={[]} />);

    expect(screen.queryByTestId('run-step-counts')).toBeNull();
  });

  it('shows each step with its read mode and counts, an unknown created count as empty', () => {
    render(
      <RunStepCounts
        stepCounts={[
          { step: 'inventory', entity: 'assets', mode: 'full', read: 1403, written: 1400, created: null, removed: 2, skipped: 3 },
          { step: 'observations', entity: 'findings', mode: 'incremental', read: 0, written: 0, created: null, removed: 0, skipped: 0 },
        ]}
      />,
    );

    const block = screen.getByTestId('run-step-counts');
    expect(within(block).getByText('Inventory, full read')).toBeTruthy();
    expect(within(block).getByText('Assets read')).toBeTruthy();
    expect(within(block).getByText('1,403')).toBeTruthy();
    expect(within(block).getByText('Assets removed')).toBeTruthy();
    expect(within(block).getByText('Observations, incremental read')).toBeTruthy();
    expect(within(block).getByText('Findings written')).toBeTruthy();
  });
});
