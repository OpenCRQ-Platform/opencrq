/** @vitest-environment jsdom */
import { Combobox, ComboboxField, ComboboxInput } from '@filigran/design-system';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WheelEventHandler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComboboxPanel } from './combobox-panel';

afterEach(() => {
  cleanup();
});

const renderPanel = (onWheel?: WheelEventHandler<HTMLDivElement>) => {
  const onOuterWheel = vi.fn();

  render(
    <div onWheel={onOuterWheel}>
      <Combobox
        open
        options={['alpha']}
        value={null}
        onValueChange={() => {}}
        getOptionLabel={(option) => option}
      >
        <ComboboxField>
          <ComboboxInput aria-label="options" />
        </ComboboxField>
        <ComboboxPanel listAriaLabel="suggestions" onWheel={onWheel} />
      </Combobox>
    </div>,
  );

  return { list: screen.getByRole('listbox', { name: 'suggestions' }), onOuterWheel };
};

describe('ComboboxPanel', () => {
  it('should not let a wheel event bubble past the panel', () => {
    const { list, onOuterWheel } = renderPanel();

    fireEvent.wheel(list);

    expect(onOuterWheel).not.toHaveBeenCalled();
  });

  it('should still call the supplied onWheel handler', () => {
    const onWheel = vi.fn();
    const { list } = renderPanel(onWheel);

    fireEvent.wheel(list);

    expect(onWheel).toHaveBeenCalledTimes(1);
  });
});
