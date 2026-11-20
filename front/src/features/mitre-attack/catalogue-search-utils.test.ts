import { describe, expect, it } from 'vitest';
import { searchCatalogue } from './catalogue-search-utils';

const entry = (externalId: string, name: string, description = '') => ({ id: `id-${externalId}`, externalId, name, description });

const catalogue = [
  entry('T1059', 'Command and Scripting Interpreter', 'Adversaries may abuse PowerShell and other interpreters.'),
  entry('T1059.001', 'PowerShell'),
  entry('T1059.003', 'Windows Command Shell'),
  entry('T1546.013', 'PowerShell Profile'),
  entry('T1105', 'Ingress Tool Transfer', 'Adversaries may transfer tools with PowerShell.'),
];

const ids = (search: string) => searchCatalogue(catalogue, search).map((row) => row.externalId);

describe('searchCatalogue', () => {
  it('should keep every entry when the search is empty', () => {
    expect(ids('')).toHaveLength(5);
  });

  it('should keep every entry when the search is only spaces', () => {
    expect(ids('   ')).toHaveLength(5);
  });

  it('should keep a technique and its sub-techniques when searched by identifier', () => {
    expect(ids('t1059')).toEqual(['T1059', 'T1059.001', 'T1059.003']);
  });

  it('should keep the entries whose name contains the search, ignoring case', () => {
    expect(ids('powershell')).toEqual(['T1059.001', 'T1546.013']);
  });

  it('should ignore the spaces around the search', () => {
    expect(ids('  PowerShell ')).toEqual(['T1059.001', 'T1546.013']);
  });

  it('should not match a term found only in a description', () => {
    expect(ids('adversaries')).toEqual([]);
  });

  it('should return no entry when nothing matches', () => {
    expect(ids('kerberoasting')).toEqual([]);
  });
});

describe('searchCatalogue accents', () => {
  const accented = [entry('T1', 'École Straße'), entry('T2', 'ecole plain')];

  it('should find an accented name from its plain spelling', () => {
    expect(searchCatalogue(accented, 'ecole').map((row) => row.externalId)).toEqual(['T1', 'T2']);
    expect(searchCatalogue(accented, 'strasse').map((row) => row.externalId)).toEqual(['T1']);
  });

  it('should find a plain name from an accented search', () => {
    expect(searchCatalogue(accented, 'éco').map((row) => row.externalId)).toEqual(['T1', 'T2']);
  });
});
