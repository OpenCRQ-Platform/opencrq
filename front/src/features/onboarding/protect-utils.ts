import type { PrimaryAssetOnboardingTemplate } from '@app/module/client';
import { PRIMARY_ASSET_ONBOARDING_TEMPLATES } from '@app/module/client';
import type { DependencyGraphPayload } from '../asset-dependencies/dependency-graph-utils';

export type ProtectTemplateKey = PrimaryAssetOnboardingTemplate;

export interface ProtectTemplate {
  key: ProtectTemplateKey,
  /** The `code` of the business value category the primary asset is created with. */
  categoryCode: string,
}

const CATEGORY_CODES: Readonly<Record<ProtectTemplateKey, string>> = {
  'customer-data': 'personal-data',
  'payments-and-treasury': 'own-funds-and-payment-authority',
  'production-and-operations': 'operations-and-services',
  'hr-data': 'personal-data',
  'intellectual-property': 'proprietary-information',
  'email-and-collaboration': 'operations-and-services',
};

export const PROTECT_TEMPLATES: ReadonlyArray<ProtectTemplate> = PRIMARY_ASSET_ONBOARDING_TEMPLATES.map((key) => ({
  key,
  categoryCode: CATEGORY_CODES[key],
}));

export const findCategoryId = (categories: ReadonlyArray<{ id: string, code: string }>, code: string): string | undefined =>
  categories.find((category) => category.code === code)?.id;

/** A template is added once the scope holds the primary asset it created, whatever that asset is named now. */
export const findTemplateAsset = <T extends { onboardingTemplate: ProtectTemplateKey | null }>(assets: ReadonlyArray<T>, key: ProtectTemplateKey): T | undefined =>
  assets.find((asset) => asset.onboardingTemplate === key);

/** The asset the reader picked, else the first one, so the graph always has something to show once the scope holds an asset. */
export const resolveSelectedAsset = <T extends { id: string }>(assets: ReadonlyArray<T>, selectedId: string | null): T | null =>
  assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null;

/** Adds the id to the hidden ones, or removes it when already there. */
export const toggleHiddenId = (hiddenIds: ReadonlyArray<string>, id: string): Array<string> =>
  hiddenIds.includes(id) ? hiddenIds.filter((hiddenId) => hiddenId !== id) : [...hiddenIds, id];

/** The filters of the graph: a primary asset the reader hid is out, with the supporting assets only it reaches. */
export const visiblePrimaryAssets = <T extends { id: string }>(assets: ReadonlyArray<T>, hiddenIds: ReadonlyArray<string>): Array<T> =>
  assets.filter((asset) => !hiddenIds.includes(asset.id));

/**
 * One graph out of the graphs of several primary assets: an asset or a link met in two graphs is
 * drawn once, by id. A fold of an asset's providers survives only when every graph holding the asset
 * folds it, since a graph that drew them already shows them. The count of assets left out is the
 * largest of the graphs', and 0 once no fold remains: the distinct assets two graphs leave out
 * cannot be told from their counts.
 */
export const mergeDependencyGraphs = (graphs: ReadonlyArray<DependencyGraphPayload>): DependencyGraphPayload => {
  const assets = new Map<string, DependencyGraphPayload['assets'][number]>();
  const links = new Map<string, DependencyGraphPayload['links'][number]>();
  const holders = new Map<string, number>();
  const folds = new Map<string, Array<DependencyGraphPayload['truncated'][number]>>();

  for (const graph of graphs) {
    for (const asset of graph.assets) {
      holders.set(asset.id, (holders.get(asset.id) ?? 0) + 1);
      if (!assets.has(asset.id)) {
        assets.set(asset.id, asset);
      }
    }
    for (const link of graph.links) {
      if (!links.has(link.id)) {
        links.set(link.id, link);
      }
    }
    for (const fold of graph.truncated) {
      folds.set(fold.assetId, [...folds.get(fold.assetId) ?? [], fold]);
    }
  }

  const truncated = [...folds].flatMap(([assetId, entries]) => {
    const [narrowest] = [...entries].sort((a, b) => a.hiddenProviderCount - b.hiddenProviderCount);
    return narrowest !== undefined && entries.length >= (holders.get(assetId) ?? 0) ? [narrowest] : [];
  });

  return {
    assets: [...assets.values()],
    links: [...links.values()],
    truncated,
    hiddenAssetCount: truncated.length === 0 ? 0 : Math.max(...graphs.map((graph) => graph.hiddenAssetCount)),
  };
};
