/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CrqRun } from './crq-run-cards';
import { CrqProvenanceCard } from './crq-run-cards';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const runWith = (provenance: Partial<CrqRun>): CrqRun => {
  const base = {
    createdAt: new Date('2026-09-14T10:00:00Z').toISOString(),
    iterations: 10_000,
    calibrationVintage: null,
    catalogueVintage: null,
    threatEvidenceMode: null,
    threatAttributionKappa: null,
    cornerConstants: null,
    estateMode: null,
    estateAssetCount: null,
    boostApplied: null,
    admittedActorCount: null,
    ...provenance,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the card reads the provenance fields alone, and the run row carries thirty more
  return base as unknown as CrqRun;
};

const renderCard = (provenance: Partial<CrqRun>) => render(
  <I18nProvider i18n={i18n}>
    <CrqProvenanceCard run={runWith(provenance)} />
  </I18nProvider>,
);

const rowValue = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe('CrqProvenanceCard', () => {
  it('reads a closed run as its mapped assets, counted', () => {
    renderCard({ estateMode: 'closed', estateAssetCount: 40_001 });

    expect(screen.getByText('Mapped assets only (40,001 assets)')).toBeTruthy();
  });

  it('reads an open run as the whole estate, counted', () => {
    renderCard({ estateMode: 'open', estateAssetCount: 300_019 });

    expect(screen.getByText('Whole estate (300,019 assets)')).toBeTruthy();
  });

  it('puts a one-asset estate in the singular', () => {
    renderCard({ estateMode: 'closed', estateAssetCount: 1 });

    expect(screen.getByText('Mapped assets only (1 asset)')).toBeTruthy();
  });

  it('reads the boost the run recorded', () => {
    renderCard({ estateMode: 'closed', estateAssetCount: 19, boostApplied: 10 });

    expect(screen.getByText('x10')).toBeTruthy();
  });

  it('reads a boost that separated nothing as None', () => {
    renderCard({ estateMode: 'closed', estateAssetCount: 4, boostApplied: 1 });

    expect(screen.getByText('None')).toBeTruthy();
  });

  it('reads the admitted actors the run recorded', () => {
    renderCard({ admittedActorCount: 12 });

    expect(rowValue('Admitted actors')).toBe('12');
  });

  it('reads a run older than its admitted actor count as empty', () => {
    renderCard({ admittedActorCount: null });

    expect(rowValue('Admitted actors')).toBe('-');
  });
});
