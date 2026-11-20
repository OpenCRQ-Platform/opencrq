/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TargetedCountriesMapCanvasProps } from './targeted-countries-map-canvas';
import { TargetedCountriesMap } from './targeted-countries-map';

// The canvas needs WebGL, which jsdom lacks; the wrapper is what is under test.
vi.mock('./targeted-countries-map-canvas', () => ({
  TargetedCountriesMapCanvas: ({ height, selectedCountryId, onSelect }: TargetedCountriesMapCanvasProps) => (
    <button type="button" data-height={height} onClick={() => onSelect?.(selectedCountryId)}>canvas</button>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('TargetedCountriesMap', () => {
  it('leaves the height to its parent when none is given', async () => {
    render(<TargetedCountriesMap locations={[]} selectedCountryId={null} onSelect={vi.fn()} />);

    const canvas = await screen.findByRole('button', { name: 'canvas' });
    expect(canvas.hasAttribute('data-height')).toBe(false);
  });

  it('hands the selection back to the page', async () => {
    const onSelect = vi.fn();
    render(<TargetedCountriesMap locations={[]} selectedCountryId="country-fr" onSelect={onSelect} height={520} />);

    const canvas = await screen.findByRole('button', { name: 'canvas' });
    canvas.click();

    expect(canvas.getAttribute('data-height')).toBe('520');
    expect(onSelect).toHaveBeenCalledWith('country-fr');
  });
});
