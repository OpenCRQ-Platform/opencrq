import { describe, expect, it } from 'vitest';
import { filterPrimaryAssets } from './primary-assets-utils';

describe('filterPrimaryAssets', () => {
  const rows = [
    { name: 'Payroll', description: 'Monthly salary run', reference: 'PEO-02' },
    { name: 'Customer onboarding', description: 'Identity checks before opening an account', reference: null },
    { name: 'Trésorerie', description: null, reference: 'FIN-01' },
  ];

  it('should keep every row for a blank search', () => {
    expect(filterPrimaryAssets(rows, '  ')).toEqual(rows);
  });

  it('should match the name, ignoring case', () => {
    expect(filterPrimaryAssets(rows, 'PAYROLL').map((row) => row.name)).toEqual(['Payroll']);
  });

  it('should match the description alone', () => {
    expect(filterPrimaryAssets(rows, 'identity').map((row) => row.name)).toEqual(['Customer onboarding']);
  });

  it('should ignore accents', () => {
    expect(filterPrimaryAssets(rows, 'tresorerie').map((row) => row.name)).toEqual(['Trésorerie']);
  });

  it('should skip a row without a description that does not match by name', () => {
    expect(filterPrimaryAssets(rows, 'salary').map((row) => row.name)).toEqual(['Payroll']);
  });

  it('should match the reference', () => {
    expect(filterPrimaryAssets(rows, 'fin-01').map((row) => row.name)).toEqual(['Trésorerie']);
  });
});
