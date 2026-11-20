import { describe, expect, it } from 'vitest';
import type { AiTargetAssetProperties, AssetObservation } from '../types';
import { buildAssetIdentityIndex } from '../asset-identity';

let seq = 0;

type FlatObservation = Omit<AssetObservation, 'properties'> & Omit<AiTargetAssetProperties, 'family'>;

const observation = (overrides: Partial<FlatObservation> & { source: string, sourceAssetId: string }): AssetObservation => {
  const merged: FlatObservation = {
    id: `obs-${seq++}`,
    connectorId: `connector-${overrides.source}`,
    origin: 'connector',
    reportedName: null,
    reportedCategoryId: 'ai_target',
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
    provider: null,
    endpointUrl: null,
    normalizedEndpointUrl: null,
    model: null,
    modality: null,
    systemPrompt: null,
    ...overrides,
  };
  const { provider, endpointUrl, normalizedEndpointUrl, model, modality, systemPrompt, ...common } = merged;
  return {
    ...common,
    properties: { family: 'ai_target', provider, endpointUrl, normalizedEndpointUrl, model, modality, systemPrompt },
  };
};

describe('buildAssetIdentityIndex — ai_target family', () => {
  it('joins two observations sharing the same normalised endpoint URL and model', () => {
    const first = observation({
      source: 'openaev', sourceAssetId: 'ai-1', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: first }]);

    const second = observation({
      source: 'openaev', sourceAssetId: 'ai-2', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    expect(index.resolve(second)).toBe('asset-1');
  });

  it('never fuses two AI targets differing only by model', () => {
    const first = observation({
      source: 'openaev', sourceAssetId: 'ai-1', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: first }]);

    const second = observation({
      source: 'openaev', sourceAssetId: 'ai-2', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o-mini',
    });
    expect(index.resolve(second)).toBeUndefined();
  });

  it('never fuses two AI targets differing only by endpoint URL', () => {
    const first = observation({
      source: 'openaev', sourceAssetId: 'ai-1', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: first }]);

    const second = observation({
      source: 'openaev', sourceAssetId: 'ai-2', normalizedEndpointUrl: 'https://api.anthropic.com/v1/messages', model: 'gpt-4o',
    });
    expect(index.resolve(second)).toBeUndefined();
  });

  it('never fuses on a name alone: two AI targets sharing nothing but a reported name stay separate', () => {
    const first = observation({
      source: 'openaev', sourceAssetId: 'ai-1', reportedName: 'Production LLM', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: first }]);

    const second = observation({ source: 'openaev', sourceAssetId: 'ai-2', reportedName: 'Production LLM' });
    expect(index.resolve(second)).toBeUndefined();
  });

  it('never fires when either side is missing the endpoint URL or the model', () => {
    const first = observation({
      source: 'openaev', sourceAssetId: 'ai-1', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: null,
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: first }]);

    const second = observation({
      source: 'openaev', sourceAssetId: 'ai-2', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: null,
    });
    expect(index.resolve(second)).toBeUndefined();
  });

  it('never resolves an ai_target observation onto a machine that happens to share a MAC-shaped value in some other field', () => {
    const machine = observation({ source: 'openaev', sourceAssetId: 'ep-1', reportedCategoryId: 'host' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: machine }]);

    const aiTarget = observation({
      source: 'openaev', sourceAssetId: 'ai-1', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    expect(index.resolve(aiTarget)).toBeUndefined();
  });

  it('registers additively so a later observation in the same batch resolves against an earlier one', () => {
    const index = buildAssetIdentityIndex([]);
    const first = observation({
      source: 'openaev', sourceAssetId: 'ai-1', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    expect(index.resolve(first)).toBeUndefined();
    index.register('asset-1', first);

    const second = observation({
      source: 'openaev', sourceAssetId: 'ai-2', normalizedEndpointUrl: 'https://api.openai.com/v1/chat', model: 'gpt-4o',
    });
    expect(index.resolve(second)).toBe('asset-1');
  });
});
