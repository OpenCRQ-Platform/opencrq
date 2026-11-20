/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TooltipHintProvider } from '../../../../components/shared';
import { EMPTY_VALUE } from '../../../../utils/empty-value';
import { RunFigure, RunValue } from './run-changes-figure';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderIn = (node: ReactNode) => render(
  <I18nProvider i18n={i18n}>
    <TooltipHintProvider>{node}</TooltipHintProvider>
  </I18nProvider>,
);

describe('RunFigure', () => {
  it('should explain an empty figure under it', () => {
    renderIn(<RunFigure label="Before" value={null} date="Jun 1, 2026, 9:00 AM" muted />);

    expect(screen.getByText(EMPTY_VALUE)).toBeTruthy();
    expect(screen.getByText('No value on this run')).toBeTruthy();
    expect(screen.getByText('Run of Jun 1, 2026, 9:00 AM')).toBeTruthy();
  });

  it('should show the figure alone when the run has a value', () => {
    renderIn(<RunFigure label="After" value="$128K" date="Jun 1, 2026, 9:00 AM" muted={false} />);

    expect(screen.getByText('$128K')).toBeTruthy();
    expect(screen.queryByText('No value on this run')).toBeNull();
  });
});

describe('RunValue', () => {
  it('should hide the dash from a screen reader and say why the value is empty', () => {
    renderIn(<RunValue value={null} />);

    expect(screen.getByText(EMPTY_VALUE).getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('No value on this run').className).toContain('sr-only');
  });

  it('should show the value when the run has one', () => {
    renderIn(<RunValue value="$128K" />);

    expect(screen.getByText('$128K')).toBeTruthy();
    expect(screen.queryByText('No value on this run')).toBeNull();
  });
});
