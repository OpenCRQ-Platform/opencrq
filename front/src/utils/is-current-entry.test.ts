import { describe, expect, it } from 'vitest';
import { isCurrentEntry } from './is-current-entry';

describe('isCurrentEntry', () => {
  it('marks the entry the reader is in', () => {
    expect(isCurrentEntry('entry-1', 'entry-1')).toBe(true);
  });

  it('leaves the other entries unmarked', () => {
    expect(isCurrentEntry('entry-2', 'entry-1')).toBe(false);
  });

  it('marks no entry when the reader is in none', () => {
    expect(isCurrentEntry('entry-1', undefined)).toBe(false);
  });
});
