/** @vitest-environment jsdom */
import type { ActivityGrade } from '@app/module/client';
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_GRADE_SEVERITY, ActivityGradeBadge } from './activity-grade-badge';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

const GRADES: Array<ActivityGrade> = ['hot', 'warm', 'cold', 'unknown'];

const daysBeforeNow = (days: number): Date => new Date(NOW.getTime() - days * MS_PER_DAY);

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ACTIVITY_GRADE_SEVERITY', () => {
  it('tones the grades red, yellow, blue and grey', () => {
    expect(GRADES.map((grade) => ACTIVITY_GRADE_SEVERITY[grade])).toEqual(['critical', 'medium', 'info', 'neutral']);
  });

  it('keeps the four tones apart', () => {
    expect(new Set(GRADES.map((grade) => ACTIVITY_GRADE_SEVERITY[grade])).size).toBe(4);
  });
});

describe('ActivityGradeBadge', () => {
  it.each([
    [3, '3 days ago'],
    [7, 'last week'],
    [21, '3 weeks ago'],
    [60, '2 months ago'],
    [120, '4 months ago'],
    [500, 'last year'],
  ])('words a last observation %i days old as "%s"', (days, label) => {
    render(<ActivityGradeBadge lastObservedAt={daysBeforeNow(days)} />);

    expect(screen.getByText(label)).toBeTruthy();
  });

  it('shows "Not dated" when no observation exists', () => {
    render(<ActivityGradeBadge lastObservedAt={null} />);

    expect(screen.getByText('Not dated')).toBeTruthy();
  });

  it('shows "Not dated" for an unparseable date', () => {
    render(<ActivityGradeBadge lastObservedAt="not a date" />);

    expect(screen.getByText('Not dated')).toBeTruthy();
  });

  it('reads an ISO string like the equivalent Date', () => {
    const observed = daysBeforeNow(120);
    const { unmount } = render(<ActivityGradeBadge lastObservedAt={observed} />);
    const fromDate = screen.getByText('4 months ago').textContent;
    unmount();

    render(<ActivityGradeBadge lastObservedAt={observed.toISOString()} />);

    expect(screen.getByText('4 months ago').textContent).toBe(fromDate);
  });
});
