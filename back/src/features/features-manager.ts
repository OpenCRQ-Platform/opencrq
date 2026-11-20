import type { GatedFeatureFlag } from '@app/utils';
import { newError } from '@app/utils';

export interface Feature {
  key: string,
  activate: (signal: AbortSignal) => void,
  featureFlag?: GatedFeatureFlag,
}

const registry: Record<string, Feature> = {};

export const registerFeature = (feature: Feature): void => {
  const { key } = feature;
  if (registry[key]) {
    throw newError('Feature is already registered', { featureKey: key });
  }
  registry[key] = feature;
};

export const listFeatures = (): Array<Feature> => Object.values(registry);
