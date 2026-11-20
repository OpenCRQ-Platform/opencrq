import { describe, expect, it } from 'vitest';
import { urlBoolean } from './url-boolean';

describe('urlBoolean', () => {
  it('should fall back to its default when the param is absent', () => {
    expect(urlBoolean(true).parse(undefined)).toBe(true);
    expect(urlBoolean(false).parse(undefined)).toBe(false);
  });

  it('should read a boolean parsed out of the address', () => {
    expect(urlBoolean(true).parse(false)).toBe(false);
    expect(urlBoolean(false).parse(true)).toBe(true);
  });

  it('should read the two literal spellings a hand-written address may carry', () => {
    expect(urlBoolean(true).parse('false')).toBe(false);
    expect(urlBoolean(false).parse('true')).toBe(true);
  });

  it('should fall back to its default rather than read anything else as true', () => {
    expect(urlBoolean(false).parse('yes')).toBe(false);
    expect(urlBoolean(false).parse(1)).toBe(false);
    expect(urlBoolean(true).parse('')).toBe(true);
  });
});
