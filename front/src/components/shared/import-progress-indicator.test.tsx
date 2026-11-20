/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ImportProgressIndicator } from './import-progress-indicator';

afterEach(() => {
  cleanup();
});

describe('ImportProgressIndicator', () => {
  it('opens its detail when reached with the keyboard', async () => {
    render(<ImportProgressIndicator label="3 threats being processed" detail="Their columns fill in later." />);

    await userEvent.tab();

    expect(screen.getByRole('status')).toBe(document.activeElement);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Their columns fill in later.');
  });

  it('stays out of the tab order when it has no detail to show', async () => {
    render(<ImportProgressIndicator label="Initial import" />);

    await userEvent.tab();

    expect(screen.getByRole('status')).not.toBe(document.activeElement);
  });
});
