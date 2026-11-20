import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { compareFindingKeys } from './finding-lock-order';
import { ASSET_EVIDENCE_KEY, ASSET_EVIDENCE_UNIQUE, assetEvidence } from './schema';

describe('ASSET_EVIDENCE_KEY', () => {
  it('lists the columns of asset_evidence_uq, in its order, each with its type', () => {
    const bySqlName = new Map(Object.entries(getTableColumns(assetEvidence)).map(([key, column]) => [column.name, { key, column }]));
    const constraint = getTableConfig(assetEvidence).uniqueConstraints.find(({ name }) => name === ASSET_EVIDENCE_UNIQUE);

    expect(constraint?.columns.map(({ name }) => bySqlName.get(name)).map((entry) => ({ column: entry?.key, type: entry?.column.getSQLType() })))
      .toEqual(ASSET_EVIDENCE_KEY);
  });
});

describe('compareFindingKeys', () => {
  const finding = (securityPlatformType: string | null) => ({
    supportingAssetId: '019edb28-0018-7000-8000-9d0a425e6329',
    cveId: null,
    mitreTechniqueId: '019edb28-0004-7000-8000-000000000001',
    expectationType: 'detection',
    securityPlatformType,
    sourceScenarioId: 'scenario-a',
  });

  it('orders a text by its UTF-8 bytes, a character past U+FFFF after one below it', () => {
    expect(compareFindingKeys(finding('EDR-🛡'), finding('EDR-Ａ'))).toBeGreaterThan(0);
  });

  it('orders a null after any value', () => {
    expect(compareFindingKeys(finding(null), finding('EDR'))).toBeGreaterThan(0);
  });
});
