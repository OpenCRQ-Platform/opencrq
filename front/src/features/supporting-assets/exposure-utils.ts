import type { AssetCategory } from '@app/module/client';

/**
 * Whether an asset's exposure reads as not applicable rather than as unknown. Exposure is how
 * reachable a machine or a service is; no connector states one for an identity, so `unknown` there
 * is not a missing reading. A value someone set by hand is still shown as it is.
 */
export const exposureIsNotApplicable = (categoryId: AssetCategory, exposure: string): boolean =>
  categoryId === 'identity' && exposure === 'unknown';
