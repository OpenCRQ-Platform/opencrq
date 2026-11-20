/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatDate, toCalendarDate } from '../../utils';
import { DateFormInput } from './date-form-input';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  i18n.activate('en');
});

const SUNDAY = new Date(2000, 0, 2);

const weekdayName = (locale: string, day: number): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(SUNDAY.getFullYear(), SUNDAY.getMonth(), SUNDAY.getDate() + day));

const firstWeekday = (locale: string): string | null => {
  i18n.load(locale, {});
  i18n.activate(locale);
  render(<DateFormInput label="Start" value={null} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
  return screen.getAllByRole('columnheader', { hidden: true })[0].textContent;
};

const openCalendar = (locale: string, value = '2026-10-15') => {
  i18n.load(locale, {});
  i18n.activate(locale);
  render(
    <I18nProvider i18n={i18n}>
      <DateFormInput label="Start" value={value} onChange={() => {}} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Start/ }));
};

describe('DateFormInput accessible names', () => {
  it('should name the days, the month and the weekdays in the language of the application', () => {
    openCalendar('fr');

    expect(screen.getByRole('button', { name: '15 oct. 2026' })).toBeDefined();
    expect(screen.getByRole('grid', { name: 'octobre 2026' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'lundi', hidden: true })).toBeDefined();
  });

  it('should follow the language rather than the library default', () => {
    openCalendar('en');

    expect(screen.getByRole('button', { name: 'Oct 15, 2026' })).toBeDefined();
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeDefined();
  });

  it('should say which day is today', () => {
    const today = toCalendarDate(new Date());
    openCalendar('en', today);

    expect(screen.getByRole('button', { name: `Today, ${formatDate(today)}` })).toBeDefined();
  });

  it('should name the arrows from the catalogue, not from the library', () => {
    openCalendar('en');

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDefined();
  });
});

describe('DateFormInput', () => {
  it('should keep the label for assistive technology when it is hidden', () => {
    render(<DateFormInput hideLabel label="Start" value={null} onChange={() => {}} />);

    const label = screen.getByText('Start');
    expect(label.parentElement?.className).toContain('sr-only');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDefined();
  });

  it('should show the label otherwise', () => {
    render(<DateFormInput label="Start" value={null} onChange={() => {}} />);

    expect(screen.getByText('Start').parentElement?.className).not.toContain('sr-only');
  });

  it('should start the week on the day the locale starts it, whatever the language', () => {
    expect(firstWeekday('en')).toBe(weekdayName('en', 0));
    cleanup();
    expect(firstWeekday('fr')).toBe(weekdayName('fr', 1));
    cleanup();
    expect(firstWeekday('ar')).toBe(weekdayName('ar', 6));
  });
});
