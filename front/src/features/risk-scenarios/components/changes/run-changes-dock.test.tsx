/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunChangesDock } from './run-changes-dock';

// The anchor has scrolled halfway through the fold, which needs 130 more pixels of scroll: 100 falls short, 200 is enough.
const ANCHOR_TOP = -16;
const SCROLLER_TOP = 100;
const SHORT = 700;
const LONG = 800;

let scroller: HTMLDivElement;
let content: HTMLDivElement;

const renderDock = (scrollHeight: number) => {
  Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight });
  const curve = vi.fn((_collapse: number, _zoom: number) => null);
  render(<RunChangesDock header={null} summary={null} focused={false} curve={curve} />, { container: content });
  const [, frame] = Array.from(content.children).filter((child) => child instanceof HTMLElement);
  return { frame, collapse: curve.mock.lastCall?.[0] };
};

describe('RunChangesDock', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});

    scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    scroller.style.paddingTop = '0px';
    content = document.createElement('div');
    scroller.appendChild(content);
    document.body.appendChild(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return DOMRect.fromRect({ y: this === scroller ? SCROLLER_TOP : ANCHOR_TOP });
    });
  });

  afterEach(() => {
    cleanup();
    scroller.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the frame unfolded and scrolling with the page when the page cannot scroll the whole fold', () => {
    const { frame, collapse } = renderDock(SHORT);

    expect(collapse).toBe(0);
    expect(frame.classList.contains('sticky')).toBe(false);
    expect(frame.style.top).toBe('');
  });

  it('folds the frame and sticks it on the line when the page can scroll the whole fold', () => {
    const { frame, collapse } = renderDock(LONG);

    expect(collapse).toBe(0.5);
    expect(frame.classList.contains('sticky')).toBe(true);
    expect(frame.style.top).toBe('14px');
  });
});
