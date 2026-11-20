/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LossExceedanceChart } from './loss-exceedance-chart';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
});

afterEach(() => {
  cleanup();
});

const CURVE = [
  { loss: 0, probability: 0.3 },
  { loss: 1_000_000, probability: 0.12 },
  { loss: 2_000_000, probability: 0.04 },
  { loss: 4_000_000, probability: 0.001 },
];
const TOLERANCE = { annualLoss: 1_000_000, maxExceedanceProbability: 0.05 };

const renderChart = (threshold: Parameters<typeof LossExceedanceChart>[0]['threshold']) => render(
  createElement(LossExceedanceChart, { curve: CURVE, aleMean: 800_000, threshold }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

describe('LossExceedanceChart', () => {
  it('draws the curve, the ALE, the breach, the guides and the tolerance diamond', () => {
    const breach = [{ loss: 1_000_000, probability: 0.12 }, { loss: 1_875_000, probability: 0.05 }];
    const { container } = renderChart({ tolerance: TOLERANCE, reading: { probability: 0.12, beyondTail: false }, outside: true, breach });

    const svg = screen.getByRole('img', { name: "Probability that the year's loss exceeds each amount" });
    expect(svg.querySelector('polygon')).not.toBeNull();
    expect(svg.querySelectorAll('polyline')).toHaveLength(2);
    expect(svg.querySelectorAll('g[stroke-dasharray="3 4"] line')).toHaveLength(2);
    expect(svg.querySelector('circle')).not.toBeNull();
    expect(svg.querySelector('rect[transform^="rotate(45"]')).not.toBeNull();
    expect(screen.getByText('ALE $800K')).toBeTruthy();
    expect(screen.getByText('Annual loss')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Risk tolerance point"]')).not.toBeNull();
  });

  it('runs both tolerance guides across the whole plot, not only up to the tolerance point', () => {
    const { container } = renderChart({ tolerance: TOLERANCE, reading: { probability: 0.12, beyondTail: false }, outside: true, breach: [] });

    const [horizontal, vertical] = Array.from(container.querySelectorAll('g[stroke-dasharray="3 4"] line'));
    expect([horizontal.getAttribute('x1'), horizontal.getAttribute('x2')]).toEqual(['52', '564']);
    expect([vertical.getAttribute('y1'), vertical.getAttribute('y2')]).toEqual(['196', '16']);
  });

  it('draws neither the tolerance point nor the breach without a threshold', () => {
    const { container } = renderChart(null);

    const svg = screen.getByRole('img');
    expect(svg.querySelectorAll('polyline')).toHaveLength(1);
    expect(svg.querySelector('rect')).toBeNull();
    expect(svg.querySelector('circle')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
