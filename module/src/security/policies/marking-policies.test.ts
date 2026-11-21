import { PgDialect } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import type { EventOrigin, GatekeeperResult } from '../policy';
import { threatAnalyses, threatAnalysisAliases } from '../../modules';
import { originMarkingScope, threatAnalysisMarkingPolicy, threatMarkingPolicy } from './marking-policies';

const userId = uuidv7();
const tenantId = uuidv7();
const TLP_GREEN = 'marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da';
const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

const client = (markings?: ReadonlyArray<string> | null): EventOrigin => ({ type: 'client', userId, tenantId, markings });

const render = (result: GatekeeperResult) => {
  if (!result) {
    throw new Error('expected a predicate, got undefined');
  }
  return new PgDialect().sqlToQuery(result);
};

const readThreats = (origin: EventOrigin) => threatMarkingPolicy.read?.(origin, threatAnalyses);
const readAliases = (origin: EventOrigin) => threatAnalysisMarkingPolicy.read?.(origin, threatAnalysisAliases);

describe('originMarkingScope', () => {
  it('should carry the markings of a person reading for themselves', () => {
    expect(originMarkingScope(client([TLP_GREEN]))).toEqual([TLP_GREEN]);
  });

  it('should fail closed for a person whose markings are unknown', () => {
    expect(originMarkingScope(client())).toBeNull();
    expect(originMarkingScope(client(null))).toBeNull();
  });

  it.each<EventOrigin>([
    { type: 'auth' },
    { type: 'system' },
    { type: 'platform', userId },
    { type: 'connector', serviceAccountId: uuidv7(), tenantId },
    { type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: false },
    { type: 'client', userId, tenantId, job: { jobKind: 'crq-simulation', interactive: true } },
  ])('should not narrow a $type origin, so scores blend every source', (origin) => {
    expect(originMarkingScope(origin)).toBeUndefined();
  });
});

describe('threatMarkingPolicy', () => {
  it('should hide every mirrored threat from a person whose markings are unknown', () => {
    const { sql, params } = render(readThreats(client(null)));

    expect(sql).toContain('<> \'connector\'');
    expect(sql).not.toContain('<@');
    expect(params).toEqual([]);
  });

  it('should keep a mirrored threat only when all its markings are the reader\'s', () => {
    const { sql, params } = render(readThreats(client([TLP_GREEN, TLP_RED])));

    expect(sql).toContain('"marking_refs" is not null');
    expect(sql).toContain('<@ array[');
    expect(params).toEqual([TLP_GREEN, TLP_RED]);
  });

  it('should still show unmarked mirrored threats to a reader with no marking', () => {
    const { sql } = render(readThreats(client([])));

    expect(sql).toContain('<@ \'{}\'::text[]');
  });

  it('should add no predicate for a job, so a recompute reads every threat', () => {
    expect(readThreats({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: false })).toBeUndefined();
  });

  it('should leave writes to the tenant rules', () => {
    expect(threatMarkingPolicy.update?.(client([]), threatAnalyses)).toBeUndefined();
    expect(threatMarkingPolicy.delete?.(client([]), threatAnalyses)).toBeUndefined();
    expect(threatMarkingPolicy.create).toBeUndefined();
  });
});

describe('threatAnalysisMarkingPolicy', () => {
  it('should make a child row follow the markings of its threat', () => {
    const { sql, params } = render(readAliases(client([TLP_GREEN])));

    expect(sql).toContain('from threat_analyses as marked');
    expect(sql).toContain('"analysis_id"');
    expect(params).toEqual([TLP_GREEN]);
  });

  it('should add no predicate for a connector origin', () => {
    expect(readAliases({ type: 'connector', serviceAccountId: uuidv7(), tenantId })).toBeUndefined();
  });
});
