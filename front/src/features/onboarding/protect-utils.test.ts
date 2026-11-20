import { describe, expect, it } from 'vitest';
import { PRIMARY_ASSET_ONBOARDING_TEMPLATES } from '@app/module/client';
import type { DependencyGraphPayload } from '../asset-dependencies/dependency-graph-utils';
import { findCategoryId, findTemplateAsset, mergeDependencyGraphs, PROTECT_TEMPLATES, resolveSelectedAsset, toggleHiddenId, visiblePrimaryAssets } from './protect-utils';

describe('PROTECT_TEMPLATES', () => {
  it('holds one template per key, in the key order', () => {
    expect(PROTECT_TEMPLATES.map((template) => template.key)).toEqual([...PRIMARY_ASSET_ONBOARDING_TEMPLATES]);
  });

  it('maps each template to its business value category', () => {
    expect(PROTECT_TEMPLATES.map((template) => [template.key, template.categoryCode])).toEqual([
      ['customer-data', 'personal-data'],
      ['payments-and-treasury', 'own-funds-and-payment-authority'],
      ['production-and-operations', 'operations-and-services'],
      ['hr-data', 'personal-data'],
      ['intellectual-property', 'proprietary-information'],
      ['email-and-collaboration', 'operations-and-services'],
    ]);
  });
});

describe('findCategoryId', () => {
  const categories = [{ id: 'a', code: 'personal-data' }, { id: 'b', code: 'operations-and-services' }];

  it('finds a category by its code', () => {
    expect(findCategoryId(categories, 'operations-and-services')).toBe('b');
  });

  it('is undefined for a code the tenant has no category for', () => {
    expect(findCategoryId(categories, 'payment-card-data')).toBeUndefined();
  });
});

describe('findTemplateAsset', () => {
  const assets = [
    { id: '1', name: 'Clients', onboardingTemplate: 'customer-data' as const },
    { id: '2', name: 'Ledger', onboardingTemplate: null },
  ];

  it('finds the primary asset the template created, whatever its name is now', () => {
    expect(findTemplateAsset(assets, 'customer-data')?.id).toBe('1');
  });

  it('is undefined when no primary asset came from that template', () => {
    expect(findTemplateAsset(assets, 'hr-data')).toBeUndefined();
  });

  it('does not take a primary asset created by hand for a template, even under its name', () => {
    expect(findTemplateAsset([{ id: '3', name: 'HR data', onboardingTemplate: null }], 'hr-data')).toBeUndefined();
  });
});

describe('resolveSelectedAsset', () => {
  const assets = [{ id: '1' }, { id: '2' }];

  it('returns the picked asset', () => {
    expect(resolveSelectedAsset(assets, '2')).toEqual({ id: '2' });
  });

  it('falls back to the first asset when nothing is picked', () => {
    expect(resolveSelectedAsset(assets, null)).toEqual({ id: '1' });
  });

  it('falls back to the first asset when the picked one is gone', () => {
    expect(resolveSelectedAsset(assets, '9')).toEqual({ id: '1' });
  });

  it('is null for a scope with no primary asset', () => {
    expect(resolveSelectedAsset([], null)).toBeNull();
  });
});

describe('toggleHiddenId', () => {
  it('hides a shown primary asset', () => {
    expect(toggleHiddenId(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('shows a hidden primary asset again', () => {
    expect(toggleHiddenId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('visiblePrimaryAssets', () => {
  const assets = [{ id: '1' }, { id: '2' }, { id: '3' }];

  it('shows every primary asset by default', () => {
    expect(visiblePrimaryAssets(assets, [])).toEqual(assets);
  });

  it('leaves out the hidden ones', () => {
    expect(visiblePrimaryAssets(assets, ['2'])).toEqual([{ id: '1' }, { id: '3' }]);
  });

  it('can leave nothing', () => {
    expect(visiblePrimaryAssets(assets, ['1', '2', '3'])).toEqual([]);
  });
});

describe('mergeDependencyGraphs', () => {
  const asset = (id: string): DependencyGraphPayload['assets'][number] => ({
    id, name: id, derivedName: null, categoryId: 'host', criticality: 'medium', exposure: 'internal', ownerName: null, firstSeenAt: null, lastSeenAt: null,
    postureScore: null, criticalFindingCount: 0, highFindingCount: 0,
  });
  const link = (id: string, dependentId: string, providerId: string): DependencyGraphPayload['links'][number] => ({ id, dependentId, providerId, kind: 'depends_on', roles: null });
  const graph = (overrides: Partial<DependencyGraphPayload>): DependencyGraphPayload => ({ assets: [], links: [], truncated: [], hiddenAssetCount: 0, ...overrides });

  it('is an empty graph when there is none to merge', () => {
    expect(mergeDependencyGraphs([])).toEqual(graph({}));
  });

  it('draws a supporting asset shared by two primary assets once', () => {
    const merged = mergeDependencyGraphs([
      graph({ assets: [asset('shared'), asset('a-only')], links: [link('l1', 'pa', 'shared'), link('l2', 'pa', 'a-only')] }),
      graph({ assets: [asset('shared'), asset('b-only')], links: [link('l3', 'pb', 'shared'), link('l4', 'pb', 'b-only')] }),
    ]);

    expect(merged.assets.map((entry) => entry.id)).toEqual(['shared', 'a-only', 'b-only']);
    expect(merged.links.map((entry) => entry.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
  });

  it('keeps a link met in two graphs once', () => {
    const merged = mergeDependencyGraphs([
      graph({ assets: [asset('x'), asset('y')], links: [link('l1', 'pa', 'x'), link('l2', 'x', 'y')] }),
      graph({ assets: [asset('x'), asset('y')], links: [link('l3', 'pb', 'x'), link('l2', 'x', 'y')] }),
    ]);

    expect(merged.links.map((entry) => entry.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('keeps the fold of an asset every graph holding it folds, with the fewest providers left out', () => {
    const merged = mergeDependencyGraphs([
      graph({ assets: [asset('x')], truncated: [{ assetId: 'x', hiddenProviderCount: 3, foldedBy: 'depth' }], hiddenAssetCount: 4 }),
      graph({ assets: [asset('x')], truncated: [{ assetId: 'x', hiddenProviderCount: 2, foldedBy: 'depth' }], hiddenAssetCount: 2 }),
    ]);

    expect(merged.truncated).toEqual([{ assetId: 'x', hiddenProviderCount: 2, foldedBy: 'depth' }]);
    expect(merged.hiddenAssetCount).toBe(4);
  });

  it('drops the fold of an asset another graph draws in full, and the count with it', () => {
    const merged = mergeDependencyGraphs([
      graph({ assets: [asset('x')], truncated: [{ assetId: 'x', hiddenProviderCount: 3, foldedBy: 'depth' }], hiddenAssetCount: 3 }),
      graph({ assets: [asset('x'), asset('y')], links: [link('l1', 'x', 'y')] }),
    ]);

    expect(merged.truncated).toEqual([]);
    expect(merged.hiddenAssetCount).toBe(0);
  });

  it('keeps the fold of a primary asset, which only its own graph holds', () => {
    const merged = mergeDependencyGraphs([
      graph({ truncated: [{ assetId: 'pa', hiddenProviderCount: 5, foldedBy: 'width' }], hiddenAssetCount: 5 }),
      graph({}),
    ]);

    expect(merged.truncated).toEqual([{ assetId: 'pa', hiddenProviderCount: 5, foldedBy: 'width' }]);
  });
});
