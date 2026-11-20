/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyableValue } from './copyable-value';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CopyableValue', () => {
  it('should show the value in full and copy it with one click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyableValue value="01a1b357-7dae-7df4-8ee7-e83c0d8d3ace" copyLabel="Copy the instance identifier" />);

    expect(screen.getByText('01a1b357-7dae-7df4-8ee7-e83c0d8d3ace')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Copy the instance identifier' }));

    expect(writeText).toHaveBeenCalledWith('01a1b357-7dae-7df4-8ee7-e83c0d8d3ace');
  });
});
