/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JobHealth } from '@app/module/client';
import { JobHealthChip } from './job-health-chip';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

/** The tone class `Chip` renders for each severity (`Chip.mjs`'s `chipFillVariants`), read from the DOM rather than asserted from memory. */
const SEVERITY_FILL_CLASS: Record<JobHealth, string> = {
  failing: 'bg-feedback-error-secondary-transparency-30',
  running: 'bg-feedback-info-secondary-transparency-30',
  queued: 'bg-feedback-neutral-secondary-transparency-30',
  healthy: 'bg-feedback-success-secondary-transparency-30',
  never_ran: 'bg-feedback-neutral-secondary-transparency-30',
};

describe('JobHealthChip', () => {
  it('renders a failing kind as "Failing" with the critical tone', () => {
    render(<JobHealthChip health="failing" />);

    const label = screen.getByText('Failing');
    expect(label.parentElement?.className).toContain(SEVERITY_FILL_CLASS.failing);
  });

  it('renders a running kind as "Running" with the info tone', () => {
    render(<JobHealthChip health="running" />);

    const label = screen.getByText('Running');
    expect(label.parentElement?.className).toContain(SEVERITY_FILL_CLASS.running);
  });

  it('renders a healthy kind as "Healthy" with the low tone', () => {
    render(<JobHealthChip health="healthy" />);

    const label = screen.getByText('Healthy');
    expect(label.parentElement?.className).toContain(SEVERITY_FILL_CLASS.healthy);
  });

  it('renders a queued kind as "Queued" with the neutral tone', () => {
    render(<JobHealthChip health="queued" />);

    const label = screen.getByText('Queued');
    expect(label.parentElement?.className).toContain(SEVERITY_FILL_CLASS.queued);
  });

  it('renders a kind that never ran as "Never ran" with the neutral tone', () => {
    render(<JobHealthChip health="never_ran" />);

    const label = screen.getByText('Never ran');
    expect(label.parentElement?.className).toContain(SEVERITY_FILL_CLASS.never_ran);
  });
});
