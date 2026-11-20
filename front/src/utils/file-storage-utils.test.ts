import { i18n } from '@lingui/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatBytes } from './file-storage-utils';

const NNBSP = ' ';

beforeEach(() => {
  i18n.load({ en: {}, fr: {} });
  i18n.activate('en');
});

afterEach(() => {
  i18n.activate('en');
});

describe('formatBytes', () => {
  it('should count bytes in full under a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(512)).toBe('512 bytes');
  });

  it('should divide by a thousand per unit, at one decimal', () => {
    expect(formatBytes(1_000)).toBe('1.0 kB');
    expect(formatBytes(12_345)).toBe('12.3 kB');
    expect(formatBytes(2_300_000)).toBe('2.3 MB');
    expect(formatBytes(4_100_000_000)).toBe('4.1 GB');
  });

  it('should move up a unit where the rounded figure would read a thousand', () => {
    expect(formatBytes(999_940)).toBe('999.9 kB');
    expect(formatBytes(999_950)).toBe('1.0 MB');
  });

  it('should write the decimal separator and the unit as the application language does', () => {
    i18n.activate('fr');
    expect(formatBytes(512)).toBe('512 octets');
    expect(formatBytes(12_345)).toBe(`12,3${NNBSP}ko`);
    expect(formatBytes(2_300_000)).toBe(`2,3${NNBSP}Mo`);
  });
});
