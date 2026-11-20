/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScenarioAleCell } from './scenario-ale-cell';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderCell = (props: { latestRun: { aleP10: number | null, aleMean: number | null, aleP90: number | null } | null, noMappedAsset: boolean }) => render(
  <I18nProvider i18n={i18n}>
    <ScenarioAleCell latestRun={props.latestRun} noMappedAsset={props.noMappedAsset} />
  </I18nProvider>,
);

describe('ScenarioAleCell', () => {
  it('retires the figure on file when the scope maps nothing', () => {
    renderCell({ latestRun: { aleP10: 1, aleMean: 2, aleP90: 3 }, noMappedAsset: true });

    expect(screen.getByText('Not priced')).toBeTruthy();
    expect(screen.queryByText('Not simulated')).toBeNull();
  });

  it('reads a scenario that never ran as unmeasured, not as zero', () => {
    renderCell({ latestRun: null, noMappedAsset: false });

    expect(screen.getByText('Not simulated')).toBeTruthy();
  });

  it('reads the mean with its p10 to p90 band', () => {
    renderCell({ latestRun: { aleP10: 1_000, aleMean: 2_000, aleP90: 3_000 }, noMappedAsset: false });

    expect(screen.getByText('$2K')).toBeTruthy();
    expect(screen.getByText('p10 $1K - p90 $3K')).toBeTruthy();
  });

  it('says the band is not computed on a run older than its columns', () => {
    renderCell({ latestRun: { aleP10: null, aleMean: 2_000, aleP90: null }, noMappedAsset: false });

    expect(screen.getByText('Band not computed')).toBeTruthy();
  });

  it('reads the figure when there is one', () => {
    renderCell({ latestRun: { aleP10: 1_000, aleMean: 2_000, aleP90: 3_000 }, noMappedAsset: false });

    expect(screen.queryByText('Not priced')).toBeNull();
    expect(screen.queryByText('Not simulated')).toBeNull();
  });
});
