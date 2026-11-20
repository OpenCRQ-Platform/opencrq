/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberFormInput } from './number-form-input';

afterEach(() => {
  cleanup();
});

const renderInput = (value: number | undefined, onChange: (next: number | undefined) => void) => {
  render(<NumberFormInput aria-label="factor" value={value} onChange={onChange} />);
  return screen.getByLabelText<HTMLInputElement>('factor');
};

describe('NumberFormInput', () => {
  it('should call onChange with a number when a valid value is typed', () => {
    const onChange = vi.fn();
    const input = renderInput(undefined, onChange);

    fireEvent.change(input, { target: { value: '12.5' } });

    expect(onChange).toHaveBeenCalledWith(12.5);
  });

  it('should call onChange with undefined when the field is cleared', () => {
    const onChange = vi.fn();
    const input = renderInput(42, onChange);

    fireEvent.change(input, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('should render an empty input for an undefined value', () => {
    expect(renderInput(undefined, vi.fn()).value).toBe('');
  });

  it('should render an empty input for NaN rather than the NaN text', () => {
    expect(renderInput(Number.NaN, vi.fn()).value).toBe('');
  });

  it('should render the current numeric value', () => {
    expect(renderInput(180, vi.fn()).value).toBe('180');
  });

  it('should expose the underlying input through an object ref', () => {
    const ref = createRef<HTMLInputElement>();
    render(<NumberFormInput aria-label="factor" value={1} onChange={vi.fn()} ref={ref} />);

    const input = screen.getByLabelText<HTMLInputElement>('factor');
    expect(ref.current).toBe(input);

    ref.current?.focus();
    expect(document.activeElement).toBe(input);
  });

  it('should expose the underlying input through a callback ref like the one react-hook-form registers', () => {
    const received: Array<HTMLInputElement | null> = [];
    render(
      <NumberFormInput
        aria-label="factor"
        value={1}
        onChange={vi.fn()}
        ref={(node) => {
          received.push(node);
        }}
      />,
    );

    const input = screen.getByLabelText<HTMLInputElement>('factor');
    expect(received[0]).toBe(input);

    received[0]?.focus();
    expect(document.activeElement).toBe(input);
  });
});
