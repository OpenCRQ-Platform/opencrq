import type { AssetCategory } from './constants';

/**
 * Which ladder a matcher applies. Chosen per identity family, never per raw category and never
 * once for the whole platform: the two connectors' taxonomies are not aligned (Defender's `host`
 * vs OpenAEV's `mobile_device` on the same tablet), so a family absorbs that while still refusing
 * to compare a laptop to a SaaS application. `generic_asset` is the to-classify bucket and matches
 * nothing: a permissive ladder there would fuse everything not yet sorted.
 */
export const IDENTITY_FAMILY_VALUES = ['machine', 'ai_target', 'identity', 'application', 'security_platform', 'unclassified'] as const;
export type IdentityFamily = (typeof IDENTITY_FAMILY_VALUES)[number];

const CATEGORY_TO_FAMILY: Record<AssetCategory, IdentityFamily> = {
  host: 'machine',
  container_workload: 'machine',
  cloud_resource: 'machine',
  mobile_device: 'machine',
  network_device: 'machine',
  iot_ot_device: 'machine',
  identity: 'identity',
  web_application: 'application',
  saas_application: 'application',
  // Its own family: an AI target's properties are not a web app's, and the two need different
  // matchers.
  ai_target: 'ai_target',
  // Its own family with no matcher: a detection or prevention source is a product console, not a
  // machine, and fusing it with a host on a shared hostname would turn the tool into a target.
  security_platform: 'security_platform',
  generic_asset: 'unclassified',
};

/**
 * The selection reads the category the *incoming observation* reports, never the canonical
 * asset's: the canonical category is itself a resolved value, and at match time there is no
 * canonical asset yet to read it from.
 */
export const identityFamilyOf = (categoryId: AssetCategory): IdentityFamily => CATEGORY_TO_FAMILY[categoryId];
