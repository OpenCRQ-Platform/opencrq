/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TooltipHint, TooltipHintProvider } from './tooltip-hint';

afterEach(() => {
  cleanup();
});

const renderHint = (keepOpenOnPress?: boolean) => render(
  <TooltipHintProvider>
    <TooltipHint hint="Not found in OpenCTI" keepOpenOnPress={keepOpenOnPress}>
      <button type="button" aria-disabled="true">OpenCTI</button>
    </TooltipHint>
  </TooltipHintProvider>,
);

describe('TooltipHint', () => {
  it('keeps the hint open when an aria-disabled trigger is pressed, with keepOpenOnPress', async () => {
    renderHint(true);

    await userEvent.tab();
    expect((await screen.findByRole('tooltip')).textContent).toBe('Not found in OpenCTI');

    await userEvent.click(screen.getByRole('button', { name: 'OpenCTI' }));

    expect(screen.getByRole('tooltip').textContent).toBe('Not found in OpenCTI');
  });

  it('opens the hint on a press of a trigger that was not focused, with keepOpenOnPress', async () => {
    renderHint(true);

    await userEvent.click(screen.getByRole('button', { name: 'OpenCTI' }));

    expect((await screen.findByRole('tooltip')).textContent).toBe('Not found in OpenCTI');
  });

  it('closes the hint on a press by default, as the design system does', async () => {
    renderHint();

    await userEvent.tab();
    await screen.findByRole('tooltip');

    await userEvent.click(screen.getByRole('button', { name: 'OpenCTI' }));

    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
