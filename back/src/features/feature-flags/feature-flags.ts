import type { FeatureFlag, GatedFeatureFlag } from '@app/utils';
import { isFeatureFlagEnabled } from '@app/utils';
import { config } from '../../config';

/** Configuration is parsed once at boot and cached: a flag is turned on by a restart. */
export const isFeatureEnabled = (flag: GatedFeatureFlag): boolean => isFeatureFlagEnabled(config().feature_flags, flag);

/** The enabled flags, as handed to the client on the public bootstrap payload: what is on, never the registry. */
export const enabledFeatureFlags = (): ReadonlyArray<FeatureFlag> => config().feature_flags;
