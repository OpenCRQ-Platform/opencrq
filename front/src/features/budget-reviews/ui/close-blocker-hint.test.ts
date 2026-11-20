import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeBlockerHint } from './close-blocker-hint';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('closeBlockerHint', () => {
  it('gives no hint when nothing blocks the closing', () => {
    expect(closeBlockerHint(null, [])).toBeNull();
  });

  it('names the scenarios older than their ALE, the first three and then how many more', () => {
    expect(closeBlockerHint('outdated', ['Ransomware'])).toBe('Re-simulate the scenarios first: Ransomware changed since this review was priced.');
    expect(closeBlockerHint('outdated', ['A', 'B', 'C'])).toBe('Re-simulate the scenarios first: A, B, and C changed since this review was priced.');
    expect(closeBlockerHint('outdated', ['A', 'B', 'C', 'D', 'E'])).toBe('Re-simulate the scenarios first: A, B, C, and 2 more changed since this review was priced.');
  });
});
