/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScenarioLifelineSample } from './scenario-lifeline';
import { ScenarioLifeline } from './scenario-lifeline';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
});

const sample = (day: number, aleMean: number, band = true): ScenarioLifelineSample => ({
  at: `2026-01-0${day}T00:00:00.000Z`,
  aleP10: band ? aleMean * 0.5 : null,
  aleMean,
  aleP90: band ? aleMean * 1.5 : null,
});

const renderLifeline = (points: Array<ScenarioLifelineSample>) => render(
  <I18nProvider i18n={i18n}>
    <ScenarioLifeline points={points} />
  </I18nProvider>,
);

describe('ScenarioLifeline', () => {
  it('should draw a waiting track when there is no quantified history', () => {
    const { container } = renderLifeline([]);

    expect(screen.getByLabelText('No quantified simulation history')).toBeTruthy();
    expect(container.querySelector('path')!.getAttribute('stroke-dasharray')).toBe('3 4');
    expect(container.querySelector<HTMLElement>('span[style]')!.style.left).toBe('100%');
  });

  it('should fill the area under the median line', () => {
    const { container } = renderLifeline([sample(1, 100), sample(2, 200)]);

    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('fill')).toMatch(/^url\(#/);
    expect(paths[1].getAttribute('fill')).toBe('none');
  });

  it('should draw the same graph whether or not the points carry an interval', () => {
    const withInterval = renderLifeline([sample(1, 100), sample(2, 200)]);
    const withIntervalPath = withInterval.container.querySelectorAll('path')[1].getAttribute('d');
    cleanup();

    const withoutInterval = renderLifeline([sample(1, 100, false), sample(2, 200, false)]);

    expect(withoutInterval.container.querySelectorAll('path')[1].getAttribute('d')).toBe(withIntervalPath);
  });

  it('should keep every stroke at one width under the horizontal stretch', () => {
    const { container } = renderLifeline([sample(1, 100), sample(2, 200)]);

    expect(container.querySelector('svg')!.getAttribute('preserveAspectRatio')).toBe('none');
    container.querySelectorAll('path[stroke="currentColor"], line').forEach((el) => {
      expect(el.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    });
  });

  it('should colour a rising history as the bad direction and a falling one as the good direction', () => {
    const rising = renderLifeline([sample(1, 100), sample(2, 200)]);
    expect(rising.container.querySelector('.text-feedback-error-primary')).toBeTruthy();
    cleanup();

    const falling = renderLifeline([sample(1, 200), sample(2, 100)]);
    expect(falling.container.querySelector('.text-feedback-success-primary')).toBeTruthy();
  });

  it('should pin the end marker to the latest point', () => {
    const { container } = renderLifeline([sample(1, 100), sample(3, 200)]);

    const marker = container.querySelector<HTMLElement>('span[style]')!;
    expect(marker.style.left).toBe('100%');
    expect(parseFloat(marker.style.top)).toBeLessThan(50);
  });

  it('should place the points by date on an axis ending now', () => {
    const { container } = renderLifeline([sample(1, 100), sample(2, 200)]);

    expect(container.querySelector<HTMLElement>('span[style]')!.style.left).toBe('50%');
  });

  it('should centre the end marker when a single simulation cannot describe a line', () => {
    const { container } = renderLifeline([sample(1, 100)]);

    expect(container.querySelectorAll('path[stroke="currentColor"]')).toHaveLength(0);
    expect(container.querySelector<HTMLElement>('span[style]')!.style.left).toBe('50%');
  });

  it('should describe the series to assistive technology by its endpoints', () => {
    renderLifeline([sample(1, 100_000), sample(2, 250_000)]);

    expect(screen.getByLabelText(
      'Annual loss exposure over time, $100K at the oldest simulation and $250K at the latest',
    )).toBeTruthy();
  });
});
