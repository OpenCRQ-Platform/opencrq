/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LifelinePlot } from './lifeline-plot';

afterEach(() => {
  cleanup();
});

const renderPlot = (values: Array<number>, axisLabels: { min: string, max: string } | undefined) => render(
  <LifelinePlot
    values={values}
    xs={values.map((_, index) => index / Math.max(values.length - 1, 1))}
    marks={[]}
    active={null}
    onActiveChange={() => undefined}
    ariaLabel="curve"
    groupLabel="changes"
    renderTooltip={() => null}
    announce={() => ''}
    rise="good"
    axisLabels={axisLabels}
  />,
);

describe('LifelinePlot', () => {
  it('should print the lowest and highest values beside the plot', () => {
    renderPlot([20, 60, 40], { min: '20 %', max: '60 %' });

    expect(screen.getAllByText('20 %').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60 %').length).toBeGreaterThan(0);
  });

  it('should print a single label when the series never moves', () => {
    renderPlot([40, 40], { min: '40 %', max: '40 %' });

    // The gutter's invisible sizer holds one copy, the visible label the other.
    expect(screen.getAllByText('40 %')).toHaveLength(2);
  });

  it('should print no gutter when no labels are given', () => {
    renderPlot([20, 60], undefined);

    expect(screen.queryByText('20 %')).toBeNull();
  });
});
