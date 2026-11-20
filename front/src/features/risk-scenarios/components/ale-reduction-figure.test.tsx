/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AleReductionFigure } from './ale-reduction-figure';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderFigure = (props: Parameters<typeof AleReductionFigure>[0]) => render(
  <I18nProvider i18n={i18n}>
    <AleReductionFigure {...props} />
  </I18nProvider>,
);

describe('AleReductionFigure', () => {
  it('should read the gain with its share of the annual loss and its band', () => {
    renderFigure({ mean: 250_000, p10: 200_000, p90: 300_000, baselineAle: 1_000_000 });

    expect(screen.getByText('-$250K (25.0%)')).toBeTruthy();
    expect(screen.getByText('p10 $200K to p90 $300K')).toBeTruthy();
  });

  it('should say the band is not computed when either bound is missing, and keep the mean', () => {
    renderFigure({ mean: 250_000, p10: null, p90: null, baselineAle: 1_000_000 });

    expect(screen.getByText('-$250K (25.0%)')).toBeTruthy();
    expect(screen.getByText('Band not computed')).toBeTruthy();
  });

  it('should say the band is not computed when only one bound is missing', () => {
    renderFigure({ mean: 250_000, p10: 200_000, p90: null, baselineAle: 1_000_000 });

    expect(screen.getByText('Band not computed')).toBeTruthy();
  });

  it('should print no share when the baseline is null', () => {
    renderFigure({ mean: 250_000, p10: 200_000, p90: 300_000, baselineAle: null });

    expect(screen.getByText('-$250K')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
