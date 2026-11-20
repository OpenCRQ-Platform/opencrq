import { describe, expect, it } from 'vitest';
import { toHttpUrl } from './to-http-url';

describe('toHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(toHttpUrl('https://one.filigran.io')).toBe('https://one.filigran.io');
    expect(toHttpUrl('http://localhost:4001')).toBe('http://localhost:4001');
  });

  it('trims trailing slashes', () => {
    expect(toHttpUrl('https://one.filigran.io/')).toBe('https://one.filigran.io');
    expect(toHttpUrl('https://one.filigran.io///')).toBe('https://one.filigran.io');
  });

  it('trims surrounding whitespace (env var / copy-paste artifacts)', () => {
    expect(toHttpUrl(' https://one.filigran.io/ ')).toBe('https://one.filigran.io');
    expect(toHttpUrl('\nhttps://one.filigran.io\t')).toBe('https://one.filigran.io');
    expect(toHttpUrl('   ')).toBeNull();
  });

  it('rejects non-http(s) schemes', () => {
    expect(toHttpUrl('javascript:alert(1)')).toBeNull();
    expect(toHttpUrl('ftp://one.filigran.io')).toBeNull();
    expect(toHttpUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects malformed or empty values', () => {
    expect(toHttpUrl('not a url')).toBeNull();
    expect(toHttpUrl('')).toBeNull();
    expect(toHttpUrl(null)).toBeNull();
    expect(toHttpUrl(undefined)).toBeNull();
  });
});
