import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompanyFormValues } from './company-form';
import { companyFormSchema } from './company-form';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const values: CompanyFormValues = { name: '  Acme  ', sectorId: 'sector-id', countryId: null, revenueBand: null, employeeCount: null };

describe('companyFormSchema', () => {
  it('requires a name that is not blank', () => {
    const result = companyFormSchema.safeParse({ ...values, name: '   ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([[['name'], 'A name is required']]);
  });

  it('accepts a named company with its optional fields empty', () => {
    expect(companyFormSchema.safeParse({ ...values, sectorId: null }).success).toBe(true);
  });

  it('accepts a whole, non-negative employee count and refuses the others', () => {
    expect(companyFormSchema.safeParse({ ...values, employeeCount: 0 }).success).toBe(true);
    expect(companyFormSchema.safeParse({ ...values, employeeCount: 250 }).success).toBe(true);
    expect(companyFormSchema.safeParse({ ...values, employeeCount: -1 }).success).toBe(false);
    expect(companyFormSchema.safeParse({ ...values, employeeCount: 1.5 }).success).toBe(false);
  });
});
