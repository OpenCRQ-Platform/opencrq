import { describe, expect, it } from 'vitest';
import { compareCweIds, filterCweCatalogue } from './cwe-catalogue-utils';

const entry = (externalId: string, name: string, flags: { modified?: boolean, presentInFindings?: boolean } = {}) => ({
  externalId,
  name,
  techniqueCount: 1,
  modified: flags.modified ?? false,
  presentInFindings: flags.presentInFindings ?? false,
});

const catalogue = [
  entry('CWE-79', 'Improper Neutralization of Input During Web Page Generation', { presentInFindings: true }),
  entry('CWE-287', 'Improper Authentication', { presentInFindings: true, modified: true }),
  entry('CWE-798', 'Use of Hard-coded Credentials', { modified: true }),
  entry('CWE-1004', 'Sensitive Cookie Without HttpOnly Flag'),
];

const noFilter = { search: '', presentInFindings: false, modified: false };
const ids = (filters: Partial<typeof noFilter>) =>
  filterCweCatalogue(catalogue, { ...noFilter, ...filters }).map((row) => row.externalId);

describe('filterCweCatalogue', () => {
  it('should keep every weakness when no filter is set', () => {
    expect(ids({})).toEqual(['CWE-79', 'CWE-287', 'CWE-798', 'CWE-1004']);
  });

  it('should keep only the weaknesses present in the findings', () => {
    expect(ids({ presentInFindings: true })).toEqual(['CWE-79', 'CWE-287']);
  });

  it('should keep only the modified weaknesses', () => {
    expect(ids({ modified: true })).toEqual(['CWE-287', 'CWE-798']);
  });

  it('should combine both toggles', () => {
    expect(ids({ presentInFindings: true, modified: true })).toEqual(['CWE-287']);
  });

  it('should match the identifier, ignoring case and surrounding spaces', () => {
    expect(ids({ search: '  cwe-79 ' })).toEqual(['CWE-79', 'CWE-798']);
  });

  it('should match the name, ignoring case', () => {
    expect(ids({ search: 'improper' })).toEqual(['CWE-79', 'CWE-287']);
  });

  it('should apply the search on top of the toggles', () => {
    expect(ids({ search: 'improper', modified: true })).toEqual(['CWE-287']);
  });
});

describe('compareCweIds', () => {
  it('should order weaknesses by number rather than by text', () => {
    expect(['CWE-1004', 'CWE-287', 'CWE-79'].sort(compareCweIds)).toEqual(['CWE-79', 'CWE-287', 'CWE-1004']);
  });
});

describe('filterCweCatalogue accents', () => {
  const accented = [entry('CWE-1', 'École Straße'), entry('CWE-2', 'ecole plain')];
  const idsFor = (search: string) => filterCweCatalogue(accented, { ...noFilter, search }).map((row) => row.externalId);

  it('should find an accented name from its plain spelling, and the reverse', () => {
    expect(idsFor('strasse')).toEqual(['CWE-1']);
    expect(idsFor('ecole')).toEqual(['CWE-1', 'CWE-2']);
    expect(idsFor('éco')).toEqual(['CWE-1', 'CWE-2']);
  });
});
