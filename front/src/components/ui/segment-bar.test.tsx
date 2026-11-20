/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SegmentBar } from './segment-bar';

afterEach(() => {
  cleanup();
});

const bandsOf = (container: HTMLElement): Array<Element> => [...(container.firstElementChild?.children ?? [])];

describe('SegmentBar', () => {
  it('should separate every segment from the one before it when asked', () => {
    const { container } = render(
      <SegmentBar
        segments={[{ key: 'a', value: 0.5, color: 'red' }, { key: 'b', value: 0.3, color: 'blue' }]}
        hatchedCount={0.2}
        total={1}
        height="h-3"
        separated
      />,
    );

    expect(bandsOf(container).map((band) => band.className.includes('border-l-2'))).toEqual([false, true, true]);
    // The hatched band's own dark border variant would otherwise paint over the gap.
    expect(bandsOf(container)[2].className).toContain('dark:border-l-[hsl(var(--card))]');
    expect(bandsOf(container).every((band) => band.className.includes('min-w-2'))).toBe(true);
  });

  it('should draw no leading gap before a hatched band that follows no segment', () => {
    const { container } = render(
      <SegmentBar segments={[{ key: 'a', value: 0, color: 'red' }]} hatchedCount={0.4} total={1} height="h-3" separated />,
    );

    expect(bandsOf(container).map((band) => band.className.includes('border-l-2'))).toEqual([false]);
  });

  it('should draw no gap at all unless asked', () => {
    const { container } = render(
      <SegmentBar segments={[{ key: 'a', value: 0.5, color: 'red' }, { key: 'b', value: 0.5, color: 'blue' }]} total={1} height="h-3" />,
    );

    expect(bandsOf(container).some((band) => band.className.includes('border-l-2'))).toBe(false);
  });
});
