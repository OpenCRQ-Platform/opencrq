import { describe, expect, it } from 'vitest';
import { formatUrlList, parseUrlList } from './url-list-param';

describe('parseUrlList', () => {
  it('should return an empty array for an undefined param', () => {
    expect(parseUrlList(undefined)).toEqual([]);
  });

  it('should return an empty array for an empty string', () => {
    expect(parseUrlList('')).toEqual([]);
  });

  it('should parse a single value', () => {
    expect(parseUrlList('compliance')).toEqual(['compliance']);
  });

  it('should parse several comma-separated values, keeping their order', () => {
    expect(parseUrlList('compliance,security,legal')).toEqual(['compliance', 'security', 'legal']);
  });

  it('should drop empty entries from stray commas', () => {
    expect(parseUrlList('compliance,,security,')).toEqual(['compliance', 'security']);
  });
});

describe('formatUrlList', () => {
  it('should format an empty list as the empty param, which stripSearchParams then drops', () => {
    expect(formatUrlList([])).toBe('');
  });

  it('should format a single value with no separator', () => {
    expect(formatUrlList(['compliance'])).toBe('compliance');
  });

  it('should join several values with a comma, keeping their order', () => {
    expect(formatUrlList(['compliance', 'security', 'legal'])).toBe('compliance,security,legal');
  });

  it('should drop empty entries', () => {
    expect(formatUrlList(['compliance', '', 'security'])).toBe('compliance,security');
  });
});

describe('parseUrlList / formatUrlList round-trip', () => {
  it('should be stable for several values', () => {
    const values = ['compliance', 'security', 'legal'];
    expect(parseUrlList(formatUrlList(values))).toEqual(values);
  });

  it('should be stable for a single value', () => {
    const values = ['compliance'];
    expect(parseUrlList(formatUrlList(values))).toEqual(values);
  });

  it('should be stable for an empty list', () => {
    const values: Array<string> = [];
    expect(parseUrlList(formatUrlList(values))).toEqual(values);
  });
});
