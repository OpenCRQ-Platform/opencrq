/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProofClaim } from './claim-item';
import { ClaimItem } from './claim-item';

const NOW = new Date('2026-11-18T10:00:00.000Z');

const claim = (relStartTime: string | null, relStopTime: string | null): ProofClaim => ({
  stixRelationId: 'relationship--1',
  producerStixId: null,
  producerName: 'CERT-FR',
  isInferred: false,
  relConfidence: 80,
  relCreated: null,
  relStartTime,
  relStopTime,
  relModified: null,
  openctiStixRelationId: null,
});

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

describe('ClaimItem', () => {
  it.each([
    ['closed in the past', 'Activity window Jan 15, 2026 to Jun 15, 2026', '2026-01-15T12:00:00.000Z', '2026-06-15T12:00:00.000Z'],
    ['closed in the past with no start', 'Activity window closes Jun 15, 2026, with no opening date', null, '2026-06-15T12:00:00.000Z'],
    ['closing in the future', 'Activity window opens Jan 15, 2026, still open', '2026-01-15T12:00:00.000Z', '2026-12-31T12:00:00.000Z'],
    ['closing in the future with no start', 'Activity window still open, with no opening date', null, '2026-12-31T12:00:00.000Z'],
    ['with neither date', 'Activity window not given', null, null],
  ])('words a window %s as "%s"', (_case, sentence, relStartTime, relStopTime) => {
    render(<ClaimItem claim={claim(relStartTime, relStopTime)} statement="Targets France" unstatedConfidence={50} href={null} />);

    expect(screen.getByText(sentence)).toBeTruthy();
  });
});
