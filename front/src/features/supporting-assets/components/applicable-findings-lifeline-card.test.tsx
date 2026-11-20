/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatDate } from '../../../utils';
import { ApplicableFindingsLifeline } from './applicable-findings-lifeline-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const series = [
  { day: '2026-09-01', count: 1 },
  { day: '2026-09-02', count: 1 },
  { day: '2026-09-03', count: 3 },
  { day: '2026-09-04', count: 2 },
];

describe('ApplicableFindingsLifeline', () => {
  it('should announce the mark the arrow keys move to', () => {
    render(
      <I18nProvider i18n={i18n}>
        <ApplicableFindingsLifeline series={series} isError={false} />
      </I18nProvider>,
    );
    const plot = screen.getByRole('group');

    fireEvent.focus(plot);
    expect(screen.getByRole('status').textContent).toBe(`${formatDate('2026-09-04')}, 2 applicable findings, −1 from 3.`);

    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(screen.getByRole('status').textContent).toBe(`${formatDate('2026-09-03')}, 3 applicable findings, +2 from 1.`);
  });

  it('should say the trend could not be loaded when the query failed', () => {
    render(
      <I18nProvider i18n={i18n}>
        <ApplicableFindingsLifeline series={undefined} isError />
      </I18nProvider>,
    );

    expect(screen.getByText('The applicable findings trend could not be loaded.')).toBeTruthy();
  });
});
