/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

afterEach(() => {
  cleanup();
});

// Radix only mounts the hidden native select, and with it the echo, for a Select inside a form.
const renderSelect = (value: string, onValueChange: (next: string) => void) => render(
  <form>
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label="level"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="60">sixty</SelectItem>
        <SelectItem value="40">forty</SelectItem>
      </SelectContent>
    </Select>
  </form>,
);

const nativeSelect = (container: HTMLElement) => {
  const select = container.querySelector('select');
  if (!select) {
    throw new Error('the hidden native select Radix echoes from is missing');
  }
  return select;
};

describe('Select', () => {
  it('should not report the empty value as a selection', () => {
    const onValueChange = vi.fn();
    const { container } = renderSelect('60', onValueChange);

    fireEvent.change(nativeSelect(container), { target: { value: '' } });

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('should report a value naming an item', () => {
    const onValueChange = vi.fn();
    const { container } = renderSelect('60', onValueChange);

    fireEvent.change(nativeSelect(container), { target: { value: '40' } });

    expect(onValueChange).toHaveBeenCalledWith('40');
  });
});
