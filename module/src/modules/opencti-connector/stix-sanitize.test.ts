import { describe, expect, it } from 'vitest';
import { sanitizeStixNullBytes } from './stix-sanitize';

const NUL = '\u0000';

describe('sanitizeStixNullBytes', () => {
  it('returns an object with no null byte untouched and reports zero changes', () => {
    const data = { id: 'intrusion-set--a', name: 'Group A', aliases: ['A', 'B'], meta: { confidence: 80 } };

    const result = sanitizeStixNullBytes(data);

    expect(result.changedStrings).toBe(0);
    expect(result.data).toBe(data);
  });

  it('strips a null byte at the start, in the middle and at the end of a string', () => {
    const result = sanitizeStixNullBytes({
      leading: `${NUL}Group A`,
      middle: `Gro${NUL}up A`,
      trailing: `Group A${NUL}`,
    });

    expect(result.data).toEqual({ leading: 'Group A', middle: 'Group A', trailing: 'Group A' });
    expect(result.changedStrings).toBe(3);
  });

  it('empties a string made only of null bytes', () => {
    const result = sanitizeStixNullBytes({ description: `${NUL}${NUL}${NUL}` });

    expect(result.data).toEqual({ description: '' });
    expect(result.changedStrings).toBe(1);
  });

  it('strips a null byte inside nested objects and arrays', () => {
    const result = sanitizeStixNullBytes({
      id: 'report--a',
      external_references: [
        { source_name: `MITRE${NUL}`, url: 'https://example.com' },
        { source_name: 'Clean', description: `see${NUL} here` },
      ],
      extensions: { 'extension-definition--1': { labels: [`red${NUL}`, 'blue'] } },
    });

    expect(result.data).toEqual({
      id: 'report--a',
      external_references: [
        { source_name: 'MITRE', url: 'https://example.com' },
        { source_name: 'Clean', description: 'see here' },
      ],
      extensions: { 'extension-definition--1': { labels: ['red', 'blue'] } },
    });
    expect(result.changedStrings).toBe(3);
  });

  it('strips a null byte carried by a key', () => {
    const result = sanitizeStixNullBytes({ [`na${NUL}me`]: 'Group A' });

    expect(result.data).toEqual({ name: 'Group A' });
    expect(result.changedStrings).toBe(1);
    expect(result.droppedKeys).toBe(0);
  });

  it('keeps the first of two keys that differ only by null bytes, and reports the one it dropped', () => {
    const result = sanitizeStixNullBytes({ [`a${NUL}`]: 1, a: 2 });

    expect(result.data).toEqual({ a: 1 });
    expect(result.changedStrings).toBe(1);
    expect(result.droppedKeys).toBe(1);
  });

  it('keeps the first even when the stripped key comes second', () => {
    const result = sanitizeStixNullBytes({ a: 1, [`a${NUL}`]: 2 });

    expect(result.data).toEqual({ a: 1 });
    expect(result.droppedKeys).toBe(1);
  });

  it('leaves every other character of a string intact, escapes and non-ASCII included', () => {
    const result = sanitizeStixNullBytes({ description: `Ligne 1\nLigne 2\t"quoted" é 漢字 \\u0000 ${NUL}end` });

    expect(result.data).toEqual({ description: 'Ligne 1\nLigne 2\t"quoted" é 漢字 \\u0000 end' });
    expect(result.changedStrings).toBe(1);
  });

  it('leaves a string spelling out the escape sequence untouched', () => {
    const data = { description: 'the literal text \\u0000 is not a null byte' };

    const result = sanitizeStixNullBytes(data);

    expect(result.changedStrings).toBe(0);
    expect(result.data).toBe(data);
  });

  it('rebuilds only the branches it had to change, leaving untouched siblings by reference', () => {
    const untouchedSibling = { source_name: 'Clean', url: 'https://example.com' };
    const untouchedBranch = { labels: ['red', 'blue'] };
    const result = sanitizeStixNullBytes({
      external_references: [{ source_name: `MITRE${NUL}` }, untouchedSibling],
      extensions: untouchedBranch,
    });

    const sanitized = result.data['external_references'];
    expect(Array.isArray(sanitized) && sanitized[1]).toBe(untouchedSibling);
    expect(result.data['extensions']).toBe(untouchedBranch);
  });

  it('keeps a key that strips down to `__proto__` as an own property, off the prototype', () => {
    const result = sanitizeStixNullBytes({ [`__proto__${NUL}`]: { polluted: true } });

    expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result.data, '__proto__')?.value).toEqual({ polluted: true });
    expect(result.changedStrings).toBe(1);
    expect(result.droppedKeys).toBe(0);
  });

  it('leaves non-string leaves as they are', () => {
    const result = sanitizeStixNullBytes({ confidence: 80, revoked: false, created_by_ref: null, name: `A${NUL}` });

    expect(result.data).toEqual({ confidence: 80, revoked: false, created_by_ref: null, name: 'A' });
    expect(result.changedStrings).toBe(1);
  });
});
