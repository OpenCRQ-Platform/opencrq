import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAreaChartOptions, buildMonthlyFlowChartOptions, buildTimelineChartOptions, categoricalChartColor } from './chart-utils';

const yFormatter = (value: number) => `$${value}`;

describe('buildAreaChartOptions', () => {
  it('should use the dark primary color and dark grid in dark mode', () => {
    const options = buildAreaChartOptions({ mode: 'dark', yFormatter });
    expect(options.colors).toEqual(['#0FBCFF']);
    expect(options.grid?.borderColor).toBe('rgba(255, 255, 255, .1)');
    expect(options.tooltip?.theme).toBe('dark');
    expect(options.theme?.mode).toBe('dark');
  });

  it('should use the light primary color and light grid in light mode', () => {
    const options = buildAreaChartOptions({ mode: 'light', yFormatter });
    expect(options.colors).toEqual(['#0015A8']);
    expect(options.grid?.borderColor).toBe('rgba(0, 0, 0, .1)');
    expect(options.tooltip?.theme).toBe('light');
  });

  it('should render local datetimes on the x-axis without toolbar or legend', () => {
    const options = buildAreaChartOptions({ mode: 'light', yFormatter });
    expect(options.xaxis?.type).toBe('datetime');
    expect(options.xaxis?.labels?.datetimeUTC).toBe(false);
    expect(options.chart?.toolbar?.show).toBe(false);
    expect(options.chart?.animations?.enabled).toBe(false);
    expect(options.legend?.show).toBe(false);
  });

  it('should wire the y formatter into axis labels', () => {
    const options = buildAreaChartOptions({ mode: 'light', yFormatter });
    const yaxis = Array.isArray(options.yaxis) ? options.yaxis[0] : options.yaxis;
    expect(yaxis?.labels?.formatter?.(1500, undefined)).toBe('$1500');
    expect(yaxis?.min).toBe(0);
  });

  it('should default markers to hidden and honor an explicit size', () => {
    expect(buildAreaChartOptions({ mode: 'light', yFormatter }).markers?.size).toBe(0);
    expect(buildAreaChartOptions({ mode: 'light', yFormatter, markerSize: 5 }).markers?.size).toBe(5);
  });

  it('should wire the x window, label format, and custom tooltip when provided', () => {
    const customTooltip = () => 'html';
    const options = buildAreaChartOptions({
      mode: 'light',
      yFormatter,
      xMin: 1000,
      xMax: 2000,
      xLabelFormat: 'dd MMM',
      customTooltip,
    });
    expect(options.xaxis?.min).toBe(1000);
    expect(options.xaxis?.max).toBe(2000);
    expect(options.xaxis?.labels?.format).toBe('dd MMM');
    expect(options.tooltip?.custom).toBe(customTooltip);
    expect(buildAreaChartOptions({ mode: 'light', yFormatter }).xaxis?.min).toBeUndefined();
  });
});

describe('categoricalChartColor', () => {
  it('should alternate between the two series hues before ramping either', () => {
    expect(categoricalChartColor('light', 0, 4)).toContain('#0015A8');
    expect(categoricalChartColor('light', 1, 4)).toContain('#7C3AED');
    expect(categoricalChartColor('light', 2, 4)).toContain('#0015A8');
    expect(categoricalChartColor('light', 3, 4)).toContain('#7C3AED');
  });

  it('should never produce the same colour for two adjacent same-hue slices', () => {
    const first = categoricalChartColor('dark', 0, 4);
    const third = categoricalChartColor('dark', 2, 4);
    expect(first).not.toBe(third);
  });

  it('should not divide by zero when there is a single slice', () => {
    expect(() => categoricalChartColor('light', 0, 1)).not.toThrow();
  });
});

describe('the date axis language', () => {
  const flow = { mode: 'light', yFormatter, capacity: 10, capacityLabel: 'Capacity' } as const;

  afterEach(() => {
    vi.restoreAllMocks();
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('should name the months in the application language on every datetime chart', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    const charts = [
      buildTimelineChartOptions({ mode: 'light', yFormatter }),
      buildAreaChartOptions({ mode: 'light', yFormatter }),
      buildMonthlyFlowChartOptions(flow),
    ];
    for (const options of charts) {
      expect(options.chart?.defaultLocale).toBe('fr');
      expect(options.chart?.locales?.[0]?.options?.shortMonths?.[8]).toBe('sept.');
    }
  });

  it('should fall back to English while no language is active', () => {
    vi.spyOn(i18n, 'locale', 'get').mockReturnValue('');
    expect(buildTimelineChartOptions({ mode: 'light', yFormatter }).chart?.defaultLocale).toBe('en');
  });
});
