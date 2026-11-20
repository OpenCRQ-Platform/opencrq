import { describe, expect, it } from 'vitest';
import { urlSearchText } from './url-search-text';

describe('urlSearchText', () => {
  it('should read an absent param as the empty search', () => {
    expect(urlSearchText.parse(undefined)).toBe('');
  });

  it('should read plain text unchanged', () => {
    expect(urlSearchText.parse('vpn')).toBe('vpn');
  });

  it('should read back a purely numeric term that parseSearch turned into a number', () => {
    expect(urlSearchText.parse(3389)).toBe('3389');
  });

  it('should read back a term that parseSearch turned into a boolean', () => {
    expect(urlSearchText.parse(true)).toBe('true');
  });
});
