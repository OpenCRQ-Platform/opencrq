import { describe, expect, it } from 'vitest';
import { affectedVersionKey, referenceKey } from './enrichment-keys';

describe('referenceKey', () => {
  const reference = { cveId: 'cve-row-1', url: 'https://vendor.example/advisory', source: 'nvd@nist.gov', tags: ['Patch', 'Vendor Advisory'] };

  it('should give a missing source and a null source the same key', () => {
    expect(referenceKey({ cveId: reference.cveId, url: reference.url, tags: reference.tags })).toBe(referenceKey({ ...reference, source: null }));
    expect(referenceKey({ ...reference, source: undefined })).toBe(referenceKey({ ...reference, source: null }));
  });

  it('should give missing tags and null tags the same key', () => {
    expect(referenceKey({ cveId: reference.cveId, url: reference.url, source: reference.source })).toBe(referenceKey({ ...reference, tags: null }));
  });

  it('should tell null tags from an empty list', () => {
    expect(referenceKey({ ...reference, tags: null })).not.toBe(referenceKey({ ...reference, tags: [] }));
  });

  it('should keep the order of the tags as stored', () => {
    expect(referenceKey({ ...reference, tags: ['Vendor Advisory', 'Patch'] })).not.toBe(referenceKey(reference));
  });

  it.each([
    ['cveId', { ...reference, cveId: 'cve-row-2' }],
    ['url', { ...reference, url: 'https://vendor.example/other' }],
    ['source', { ...reference, source: 'cve@mitre.org' }],
    ['tags', { ...reference, tags: ['Patch'] }],
  ])('should change with the %s', (_field, other) => {
    expect(referenceKey(other)).not.toBe(referenceKey(reference));
  });

  it('should not confuse a value carrying a separator with two fields', () => {
    expect(referenceKey({ cveId: 'x', url: 'a', source: 'b,c', tags: null })).not.toBe(referenceKey({ cveId: 'x', url: 'a,b', source: 'c', tags: null }));
    expect(referenceKey({ cveId: 'x', url: 'a', source: null, tags: ['b', 'c'] })).not.toBe(referenceKey({ cveId: 'x', url: 'a', source: null, tags: ['b,c'] }));
  });
});

describe('affectedVersionKey', () => {
  const version = {
    cveId: 'cve-row-1',
    vendor: 'Google',
    product: 'libwebp',
    affectedFrom: '1.0.0',
    affectedUpTo: '1.3.2',
    affectedUpToIncluded: false,
  };

  it.each(['vendor', 'product', 'affectedFrom'] as const)('should give a missing %s and a null %s the same key', (field) => {
    expect(affectedVersionKey({ ...version, [field]: undefined })).toBe(affectedVersionKey({ ...version, [field]: null }));
  });

  it('should read an absent inclusion flag as the column default, false', () => {
    expect(affectedVersionKey({ ...version, affectedUpToIncluded: undefined })).toBe(affectedVersionKey(version));
  });

  it('should tell a null field from an empty string', () => {
    expect(affectedVersionKey({ ...version, vendor: null })).not.toBe(affectedVersionKey({ ...version, vendor: '' }));
  });

  it.each([
    ['cveId', { ...version, cveId: 'cve-row-2' }],
    ['vendor', { ...version, vendor: 'Mozilla' }],
    ['product', { ...version, product: 'libpng' }],
    ['affectedFrom', { ...version, affectedFrom: '1.1.0' }],
    ['affectedUpTo', { ...version, affectedUpTo: '1.3.3' }],
    ['affectedUpToIncluded', { ...version, affectedUpToIncluded: true }],
  ])('should change with the %s', (_field, other) => {
    expect(affectedVersionKey(other)).not.toBe(affectedVersionKey(version));
  });

  it('should not confuse a value carrying a separator with two fields', () => {
    expect(affectedVersionKey({ ...version, vendor: 'a', product: 'b,c' })).not.toBe(affectedVersionKey({ ...version, vendor: 'a,b', product: 'c' }));
  });
});
