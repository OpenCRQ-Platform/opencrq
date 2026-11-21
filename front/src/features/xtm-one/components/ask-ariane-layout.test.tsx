/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { FunctionComponent } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ASK_ARIANE_SIDEBAR_GAP,
  AskArianeLayoutProvider,
  askArianeContentMargin,
  useAskArianeContentPush,
  useAskArianeLayout,
} from './ask-ariane-layout';
import { designSystemTokens } from './ask-ariane-tokens';

afterEach(() => {
  cleanup();
});

describe('the room the page leaves for Ask Ariane', () => {
  it('should leave the panel width and the gap while it is docked', () => {
    expect(askArianeContentMargin({ mode: 'sidebar', sidebarWidth: 480 })).toBe(480 + ASK_ARIANE_SIDEBAR_GAP);
  });

  it('should leave nothing when the panel is closed, floating or full screen', () => {
    expect(askArianeContentMargin({ mode: null, sidebarWidth: 480 })).toBe(0);
    expect(askArianeContentMargin({ mode: 'floating', sidebarWidth: 480 })).toBe(0);
    expect(askArianeContentMargin({ mode: 'fullscreen', sidebarWidth: 480 })).toBe(0);
    expect(askArianeContentMargin(null)).toBe(0);
  });
});

let layout: ReturnType<typeof useAskArianeLayout> = null;

const Probe: FunctionComponent = () => {
  layout = useAskArianeLayout();
  const { marginRight, animate } = useAskArianeContentPush();
  return createElement('div', { 'data-testid': 'probe', 'data-margin': marginRight, 'data-animate': String(animate) });
};

const probe = () => screen.getByTestId('probe');

describe('the page pushed by the docked panel', () => {
  it('should follow the panel as it opens, is resized and closes', () => {
    render(createElement(AskArianeLayoutProvider, null, createElement(Probe)));
    expect(probe().dataset.margin).toBe('0');

    act(() => layout?.setMode('sidebar'));
    expect(probe().dataset.margin).toBe(String(400 + ASK_ARIANE_SIDEBAR_GAP));

    act(() => {
      layout?.setIsResizing(true);
      layout?.setSidebarWidth(520);
    });
    expect(probe().dataset.margin).toBe(String(520 + ASK_ARIANE_SIDEBAR_GAP));
    // No easing while the handle is dragged, or the page lags behind the pointer.
    expect(probe().dataset.animate).toBe('false');

    act(() => {
      layout?.setIsResizing(false);
      layout?.setMode(null);
    });
    expect(probe().dataset.margin).toBe('0');
    expect(probe().dataset.animate).toBe('true');
  });

  it('should push nothing outside the layout', () => {
    render(createElement(Probe));
    expect(layout).toBeNull();
    expect(probe().dataset.margin).toBe('0');
  });
});

describe('the design system tokens the panel reads', () => {
  it('should restate the composer edge and the disabled fill under their plain names', () => {
    const tokens = designSystemTokens() as Record<string, string>;
    expect(tokens['--border-elevation-subtle']).toBe('var(--fds-border-elevation-subtle)');
    expect(tokens['--bg-elevation-disabled']).toBe('var(--fds-bg-elevation-disabled)');
    expect(tokens['--text-default-primary']).toBe('var(--fds-text-default-primary)');
  });
});
