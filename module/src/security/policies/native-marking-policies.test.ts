import { PgDialect } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import type { EventOrigin, GatekeeperResult } from '../policy';
import { assetEvidence, riskScenarios, supportingAssets } from '../../modules';
import { nativeClearanceReader, nativeMarkingPolicy, supportingAssetMarkingPolicy } from './native-marking-policies';

const userId = uuidv7();
const tenantId = uuidv7();
const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

const client: EventOrigin = { type: 'client', userId, tenantId };

const render = (result: GatekeeperResult) => {
  if (!result) {
    throw new Error('expected a predicate, got undefined');
  }
  return new PgDialect().sqlToQuery(result);
};

describe('nativeClearanceReader', () => {
  it('should narrow a person reading for themselves in a tenant', () => {
    expect(nativeClearanceReader(client)).toEqual({ userId, tenantId });
  });

  it.each<EventOrigin>([
    { type: 'auth' },
    { type: 'system' },
    { type: 'platform', userId },
    { type: 'connector', serviceAccountId: uuidv7(), tenantId },
    { type: 'job', tenantId, jobKind: 'crq-simulation', interactive: false },
    { type: 'client', userId, tenantId, job: { jobKind: 'crq-simulation', interactive: true } },
  ])('should not narrow a $type origin, so scores blend every object', (origin) => {
    expect(nativeClearanceReader(origin)).toBeUndefined();
    expect(nativeMarkingPolicy.read?.(origin, supportingAssets)).toBeUndefined();
  });
});

describe('nativeMarkingPolicy.read', () => {
  it.each([['supporting_assets', supportingAssets], ['risk_scenarios', riskScenarios], ['asset_evidence', assetEvidence]] as const)(
    'should keep a %s row only when all its markings are in the reader\'s clearance or the reader is super administrator',
    (table, columns) => {
      const { sql, params } = render(nativeMarkingPolicy.read?.(client, columns));

      expect(sql).toContain(`"${table}"."marking_refs" <@ array(select cleared.stix_id from marking_definitions as cleared`);
      expect(sql).toContain('held."order" >= cleared."order"');
      expect(sql).toContain('member.user_id = $');
      expect(sql).toContain('is_super_admin');
      expect(params).toContain(userId);
      expect(params).toContain(tenantId);
    },
  );

  it('should leave update and delete to the read rule, so nobody changes a row they cannot see', () => {
    expect(nativeMarkingPolicy.update).toBeUndefined();
    expect(nativeMarkingPolicy.delete).toBeUndefined();
  });
});

describe('supportingAssetMarkingPolicy.read', () => {
  it('should keep a finding only when its supporting asset is in the reader\'s clearance or the reader is super administrator', () => {
    const { sql, params } = render(supportingAssetMarkingPolicy.read?.(client, assetEvidence));

    expect(sql).toContain('from supporting_assets as marked_asset where marked_asset.id = "asset_evidence"."supporting_asset_id"');
    expect(sql).toContain('marked_asset.marking_refs <@ array(select cleared.stix_id');
    expect(sql).toContain('is_super_admin');
    expect(params).toContain(userId);
    expect(params).toContain(tenantId);
  });

  it('should not narrow a job or a connector, so finding scores blend every finding', () => {
    expect(supportingAssetMarkingPolicy.read?.({ type: 'job', tenantId, jobKind: 'finding-score', interactive: false }, assetEvidence)).toBeUndefined();
    expect(supportingAssetMarkingPolicy.read?.({ type: 'connector', serviceAccountId: uuidv7(), tenantId }, assetEvidence)).toBeUndefined();
  });

  it('should leave update and delete to the read rule', () => {
    expect(supportingAssetMarkingPolicy.update).toBeUndefined();
    expect(supportingAssetMarkingPolicy.delete).toBeUndefined();
  });
});

describe('nativeMarkingPolicy.create', () => {
  it('should let anyone create an unmarked row', () => {
    expect(nativeMarkingPolicy.create?.(client, { tenantId, markingRefs: [] })).toBeUndefined();
    expect(nativeMarkingPolicy.create?.(client, { tenantId })).toBeUndefined();
  });

  it('should refuse a marking the creator does not hold', () => {
    const { sql, params } = render(nativeMarkingPolicy.create?.(client, { tenantId, markingRefs: [TLP_RED] }));

    expect(sql).toContain('array[$');
    expect(sql).toContain('::text[] <@ array(select cleared.stix_id');
    expect(params).toContain(TLP_RED);
    expect(params).toContain(userId);
  });

  it('should not narrow a job creating a marked row', () => {
    expect(nativeMarkingPolicy.create?.({ type: 'job', tenantId, jobKind: 'sync', interactive: false }, { tenantId, markingRefs: [TLP_RED] })).toBeUndefined();
  });
});
