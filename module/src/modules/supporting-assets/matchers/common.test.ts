import { describe, expect, it } from 'vitest';
import type { AssetObservation } from '../types';
import { buildCommonIdentityIndex } from './common';

let seq = 0;
const observation = (overrides: Partial<AssetObservation> & { source: string }): AssetObservation => ({
  id: `obs-${seq++}`,
  connectorId: `connector-${overrides.source}`,
  origin: 'connector',
  sourceAssetId: 'src-1',
  reportedName: null,
  reportedCategoryId: 'host',
  reportedSubcategoryId: null,
  reportedDescription: null,
  reportedExposure: 'unknown',
  reportedCriticality: 'unknown',
  externalReference: null,
  reportedUrl: null,
  reportedLinkedPerson: null,
  firstSeenAt: null,
  lastSeenAt: null,
  sourceLastActivityAt: new Date(0),
  ...overrides,
});

describe('buildCommonIdentityIndex', () => {
  it('joins two observations sharing the same externalReference', () => {
    const index = buildCommonIdentityIndex();
    const first = observation({ source: 'microsoft_graph', externalReference: 'ext-1' });
    index.register('asset-1', first);

    const second = observation({ source: 'openaev', externalReference: 'ext-1' });
    expect(index.resolve(second)).toBe('asset-1');
  });

  it('never fires when either side has no externalReference', () => {
    const index = buildCommonIdentityIndex();
    const first = observation({ source: 'microsoft_graph', externalReference: null });
    index.register('asset-1', first);

    const second = observation({ source: 'openaev', externalReference: null });
    expect(index.resolve(second)).toBeUndefined();
  });

  it('never fires on an empty externalReference, which is an absence rather than an identity', () => {
    const index = buildCommonIdentityIndex();
    index.register('asset-1', observation({ source: 'microsoft_graph', externalReference: '' }));

    expect(index.resolve(observation({ source: 'openaev', externalReference: '' }))).toBeUndefined();
  });

  it('registers additively so a later observation resolves against an earlier one', () => {
    const index = buildCommonIdentityIndex();
    const first = observation({ source: 'microsoft_graph', externalReference: 'ext-2' });
    expect(index.resolve(first)).toBeUndefined();
    index.register('asset-1', first);

    const second = observation({ source: 'openaev', externalReference: 'ext-2' });
    expect(index.resolve(second)).toBe('asset-1');
  });

  it('keeps the first-registered asset when a third observation later shares the same reference', () => {
    const index = buildCommonIdentityIndex();
    index.register('asset-1', observation({ source: 'microsoft_graph', externalReference: 'ext-3' }));
    index.register('asset-2', observation({ source: 'openaev', externalReference: 'ext-4' }));

    const third = observation({ source: 'openaev', externalReference: 'ext-3' });
    expect(index.resolve(third)).toBe('asset-1');
  });
});
