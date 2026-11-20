/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScenarioAleChangeCell } from './scenario-ale-change';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type Change = { delta: number, deltaPct: number | null, spanDays?: number };

const renderCell = (hasRun: boolean, change: Change | null) => render(
  <I18nProvider i18n={i18n}>
    <ScenarioAleChangeCell hasRun={hasRun} change={change} />
  </I18nProvider>,
);

describe('ScenarioAleChangeCell', () => {
  it('should render a placeholder when the scenario has never been simulated', () => {
    renderCell(false, { delta: 1000, deltaPct: 0.5 });

    expect(screen.getByText('-')).toBeTruthy();
  });

  it('should mark a scenario with only one simulation as new rather than as no change', () => {
    renderCell(true, null);

    expect(screen.getByText('New')).toBeTruthy();
  });

  it('should render an unchanged exposure without a direction', () => {
    const { container } = renderCell(true, { delta: 0, deltaPct: 0 });

    expect(screen.getByText('$0')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('should colour rising exposure as the bad direction', () => {
    const { container } = renderCell(true, { delta: 42_000, deltaPct: 0.21 });

    expect(container.querySelector('.text-feedback-error-primary')).toBeTruthy();
    expect(screen.getByText(/\$42K/)).toBeTruthy();
    expect(screen.getByText(/21%/)).toBeTruthy();
  });

  it('should colour falling exposure as the good direction and show its magnitude unsigned', () => {
    const { container } = renderCell(true, { delta: -42_000, deltaPct: -0.21 });

    expect(container.querySelector('.text-feedback-success-primary')).toBeTruthy();
    expect(screen.getByText(/\$42K/)).toBeTruthy();
    expect(screen.getByText(/21%/)).toBeTruthy();
  });

  it('should omit the percentage when the oldest point priced the scenario at zero', () => {
    renderCell(true, { delta: 42_000, deltaPct: null });

    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('should read a move under the flat threshold as neither direction', () => {
    const { container } = renderCell(true, { delta: 400, deltaPct: 0.004 });

    expect(container.querySelector('.text-feedback-error-primary')).toBeNull();
    expect(container.querySelector('.text-muted-foreground')).toBeTruthy();
  });

  it('should state the period the figure covers', () => {
    renderCell(true, { delta: 42_000, deltaPct: 0.21, spanDays: 80 });

    expect(screen.getByText('in 80 days')).toBeTruthy();
  });

  it('should say a single day in the singular', () => {
    renderCell(true, { delta: 42_000, deltaPct: 0.21, spanDays: 1 });

    expect(screen.getByText('in 1 day')).toBeTruthy();
  });

  it('should state no period where the surface names it instead', () => {
    renderCell(true, { delta: 42_000, deltaPct: 0.21 });

    expect(screen.queryByText(/^in /)).toBeNull();
  });

  it('should state no period for two readings taken the same day', () => {
    renderCell(true, { delta: 42_000, deltaPct: 0.21, spanDays: 0 });

    expect(screen.queryByText(/^in /)).toBeNull();
  });
});
