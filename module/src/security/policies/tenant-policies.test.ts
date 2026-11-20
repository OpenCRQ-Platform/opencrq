import { PgDialect } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import type { EventOrigin, GatekeeperResult } from '../policy';
import { PlatformCapability_CreateTenants, tenants, tenantUsers } from '../../modules';
import { tenantUpdatePolicy, tenantUserRowsPolicy } from './tenant-policies';

const userId = uuidv7();
const tenantId = uuidv7();
const otherTenantId = uuidv7();

const origins: Record<EventOrigin['type'], EventOrigin> = {
  auth: { type: 'auth' },
  system: { type: 'system' },
  client: { type: 'client', userId, tenantId },
  platform: { type: 'platform', userId },
  connector: { type: 'connector', serviceAccountId: uuidv7(), tenantId },
  job: { type: 'job', tenantId, jobKind: 'probe', interactive: false },
};

const unrestricted = ['auth', 'system'] as const;
const restricted = ['client', 'platform', 'connector', 'job'] as const;
const neverWrites = ['platform', 'connector', 'job'] as const;

const render = (result: GatekeeperResult) => {
  if (!result) {
    throw new Error('expected a predicate, got undefined');
  }
  return new PgDialect().sqlToQuery(result);
};

const evaluate = (rule: 'read' | 'update' | 'delete' | 'create', origin: EventOrigin, createdIn = tenantId): GatekeeperResult => {
  if (rule === 'create') {
    const create = tenantUserRowsPolicy.create;
    if (!create) {
      throw new Error('tenantUserRowsPolicy has no create rule');
    }
    return create(origin, { tenantId: createdIn, userId: uuidv7() });
  }
  const fn = tenantUserRowsPolicy[rule];
  if (!fn) {
    throw new Error(`tenantUserRowsPolicy has no ${rule} rule`);
  }
  return fn(origin, tenantUsers);
};

const rules = ['read', 'update', 'delete', 'create'] as const;

describe('tenantUserRowsPolicy', () => {
  describe.each(rules)('%s', (rule) => {
    it.each(restricted)('should not leave the whole table open to %s', (type) => {
      expect(evaluate(rule, origins[type])).toBeDefined();
    });

    it.each(unrestricted)('should add no predicate for %s', (type) => {
      expect(evaluate(rule, origins[type])).toBeUndefined();
    });
  });

  describe.each(['update', 'delete', 'create'] as const)('%s', (rule) => {
    it.each(neverWrites)('should refuse %s', (type) => {
      expect(render(evaluate(rule, origins[type])).sql).toBe('false');
    });
  });

  describe('read', () => {
    it('should give a client and a platform origin exactly the same predicate, so the header changes no right', () => {
      const asClient = render(evaluate('read', origins.client));
      const asPlatform = render(evaluate('read', origins.platform));

      expect(asClient).toEqual(asPlatform);
    });

    it('should not pin a client read to the tenant of its origin', () => {
      const { sql, params } = render(evaluate('read', origins.client));

      expect(sql).not.toBe('false');
      expect(params).not.toContain(tenantId);
    });

    it('should scope a connector read to the tenant of its origin', () => {
      expect(render(evaluate('read', origins.connector)).params).toContain(tenantId);
    });
  });

  describe('create', () => {
    it('should refuse a client adding a member to a tenant other than the one of its origin', () => {
      expect(() => evaluate('create', origins.client, otherTenantId)).toThrow('Cannot create for another tenant');
    });

    it('should grant a client a predicate for the tenant of its origin', () => {
      const { sql } = render(evaluate('create', origins.client));

      expect(sql).not.toBe('false');
    });
  });
});

describe('tenantUpdatePolicy', () => {
  const update = (origin: EventOrigin) => {
    if (!tenantUpdatePolicy.update) {
      throw new Error('tenantUpdatePolicy has no update rule');
    }
    return tenantUpdatePolicy.update(origin, tenants);
  };

  it.each(unrestricted)('should add no predicate for %s', (type) => {
    expect(update(origins[type])).toBeUndefined();
  });

  it('should refuse a job', () => {
    expect(render(update(origins.job)).sql).toBe('false');
  });

  it('should give a platform origin the Create Tenants check, leaving membership to tenantMembershipPolicy', () => {
    const { sql, params } = render(update(origins.platform));

    expect(sql).not.toContain('tenant_users');
    expect(sql).toContain('platform_role_capabilities');
    expect(params).toContain(PlatformCapability_CreateTenants);
  });

  it('should give a client origin both the security manager arm and the rename arm', () => {
    const { sql, params } = render(update(origins.client));

    expect(sql).toContain('role_capabilities');
    expect(sql).toContain('platform_role_capabilities');
    expect(sql).toContain(' or ');
    expect(params).toContain(PlatformCapability_CreateTenants);
  });

  it('should keep the rename arm of a client the same as the predicate of a platform origin', () => {
    const withoutPlaceholderIndexes = (origin: EventOrigin) => render(update(origin)).sql.replace(/\$\d+/g, '$');

    expect(withoutPlaceholderIndexes(origins.client)).toContain(withoutPlaceholderIndexes(origins.platform));
  });

  it('should not let a connector reach a platform table', () => {
    expect(render(update(origins.connector)).sql).not.toContain('platform_');
  });
});
