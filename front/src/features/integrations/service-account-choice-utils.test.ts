import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defaultServiceAccountChoice,
  refineServiceAccountChoice,
  selectableServiceAccounts,
  serviceAccountChoiceFields,
  toServiceAccountChoice,
} from './service-account-choice-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const ACTIVE = { id: 'active', name: 'Active bot', active: true };
const INACTIVE = { id: 'inactive', name: 'Old bot', active: false };

const schema = (accountRequired: boolean) => z.object(serviceAccountChoiceFields())
  .superRefine((values, ctx) => refineServiceAccountChoice(values, ctx, { accountRequired }));

describe('selectableServiceAccounts', () => {
  it('should offer the active accounts, and the configured one once deactivated', () => {
    expect(selectableServiceAccounts([ACTIVE, INACTIVE], undefined)).toEqual([ACTIVE]);
    expect(selectableServiceAccounts([ACTIVE, INACTIVE], 'inactive')).toEqual([ACTIVE, INACTIVE]);
  });
});

describe('defaultServiceAccountChoice', () => {
  it('should start an unbound integration on a new account named after the connector', () => {
    expect(defaultServiceAccountChoice('Microsoft Defender', [ACTIVE], null)).toEqual({
      serviceAccountMode: 'new',
      newServiceAccountName: 'Microsoft Defender connector',
      serviceAccountId: '',
    });
  });

  it('should start on a new account on a tenant with no account at all', () => {
    expect(defaultServiceAccountChoice('Drata', [], undefined).serviceAccountMode).toBe('new');
  });

  it('should keep the account a bound integration runs as, inactive included', () => {
    expect(defaultServiceAccountChoice('Drata', [ACTIVE, INACTIVE], 'inactive')).toMatchObject({
      serviceAccountMode: 'existing',
      serviceAccountId: 'inactive',
    });
  });

  it('should start on a new account when the bound account is no longer listed', () => {
    expect(defaultServiceAccountChoice('Drata', [ACTIVE], 'deleted')).toMatchObject({ serviceAccountMode: 'new', serviceAccountId: '' });
  });
});

describe('toServiceAccountChoice', () => {
  it('should send a new account by its trimmed name, and nothing of the select', () => {
    expect(toServiceAccountChoice({ serviceAccountMode: 'new', newServiceAccountName: '  Drata connector ', serviceAccountId: 'active' }))
      .toEqual({ newServiceAccount: { name: 'Drata connector' } });
  });

  it('should send an existing account by id, an empty one as an unbind', () => {
    expect(toServiceAccountChoice({ serviceAccountMode: 'existing', newServiceAccountName: 'x', serviceAccountId: 'active' }))
      .toEqual({ serviceAccountId: 'active' });
    expect(toServiceAccountChoice({ serviceAccountMode: 'existing', newServiceAccountName: 'x', serviceAccountId: '' }))
      .toEqual({ serviceAccountId: null });
  });
});

describe('refineServiceAccountChoice', () => {
  it('should refuse a new account with a blank name', () => {
    const parsed = schema(false).safeParse({ serviceAccountMode: 'new', newServiceAccountName: '   ', serviceAccountId: '' });

    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['newServiceAccountName']]);
  });

  it('should refuse an empty existing account only where one is required', () => {
    const values = { serviceAccountMode: 'existing', newServiceAccountName: '', serviceAccountId: '' };

    expect(schema(false).safeParse(values).success).toBe(true);
    expect(schema(true).safeParse(values).error?.issues.map((issue) => issue.path)).toEqual([['serviceAccountId']]);
  });
});
