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
    render(<RunStepCounts stepCounts={[]} firstRow={3} />);

    expect(screen.queryByTestId('run-step-counts')).toBeNull();
  });

  it('shows each step with its read mode and counts, compact from a thousand', () => {
    render(
      <RunStepCounts
        firstRow={3}
        stepCounts={[
          { step: 'inventory', entity: 'assets', mode: 'full', read: 1403, written: 999, created: null, removed: 2, skipped: 3 },
          { step: 'observations', entity: 'findings', mode: 'incremental', read: 0, written: 0, created: null, removed: 0, skipped: 0 },
        ]}
      />,
    );

    const block = screen.getByTestId('run-step-counts');
    expect(block.style.gridRowStart).toBe('3');
    expect(within(block).getByText('Inventory, full read')).toBeTruthy();
    expect(within(block).getByText('Assets read')).toBeTruthy();
    expect(within(block).getByText('1.4K')).toBeTruthy();
    expect(within(block).queryByText('1,403')).toBeNull();
    expect(within(block).getByText('999')).toBeTruthy();
    expect(within(block).getByText('Assets removed')).toBeTruthy();
    expect(within(block).getByText('Observations, incremental read')).toBeTruthy();
    expect(within(block).getByText('Findings written')).toBeTruthy();
  });

  it('leaves out a created count the step does not know, and shows it when the step reports it', () => {
    render(
      <RunStepCounts
        firstRow={3}
        stepCounts={[
          { step: 'inventory', entity: 'assets', mode: 'full', read: 10, written: 10, created: null, removed: 0, skipped: 0 },
          { step: 'observations', entity: 'findings', mode: null, read: 5, written: 5, created: 4, removed: 0, skipped: 0 },
        ]}
      />,
    );

    const block = screen.getByTestId('run-step-counts');
    expect(within(block).queryByText('Assets created')).toBeNull();
    expect(within(block).getByText('Findings created')).toBeTruthy();
    expect(within(block).getByText('4')).toBeTruthy();
  });

  it('puts the step title on a row of its own and the counts on the full row under it', () => {
    render(
      <RunStepCounts
        firstRow={3}
        stepCounts={[
          { step: 'observations', entity: 'findings', mode: null, read: 5, written: 5, created: 4, removed: 0, skipped: 1 },
        ]}
      />,
    );

    const title = screen.getByTestId('run-step-title');
    expect(title.className).toContain('col-span-full');
    const row = screen.getByTestId('run-step-count-row');
    expect(row.className).toContain('col-span-full');
    expect(row.className).not.toContain('col-start-2');
    expect(row.children).toHaveLength(5);
  });
});
