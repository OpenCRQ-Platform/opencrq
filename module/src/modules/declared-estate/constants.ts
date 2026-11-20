import type { AssetCategory, AssetSubcategory } from '../supporting-assets/constants';

export const DECLARED_ESTATE_KIND_VALUES = [
  'workstations',
  'mobile_devices',
  'people',
  'servers',
  'containers',
  'cloud_resources',
  'service_accounts',
  'web_applications',
  'saas_applications',
  'ai_systems',
  'network_devices',
  'iot_ot_devices',
] as const;
export type DeclaredEstateKind = (typeof DECLARED_ESTATE_KIND_VALUES)[number];

/** The kinds the loss derivation reads: a change to any other kind moves no loss figure. */
export const DECLARED_ESTATE_LOSS_KINDS = ['workstations', 'servers'] as const satisfies ReadonlyArray<DeclaredEstateKind>;
export type DeclaredEstateLossKind = (typeof DECLARED_ESTATE_LOSS_KINDS)[number];

export interface DeclaredEstateKindDefinition {
  readonly category: AssetCategory,
  /**
   * The subcategories the kind counts, for the two categories split in two kinds; null counts the
   * whole category. A subcategory listed by no kind of its category counts in no kind.
   */
  readonly subcategories: ReadonlyArray<AssetSubcategory> | null,
  readonly exposable: boolean,
  /** The subcategory a virtual asset of the kind carries, so the door's applicability rule reads it as its real assets. */
  readonly virtualSubcategory: AssetSubcategory | null,
}

/**
 * A host with no subcategory counts as a workstation, as the door's applicability rule already reads
 * it. Groups, roles and shared mailboxes are no account anyone acts through, and `generic_asset` is
 * still to classify, so neither counts in any kind.
 */
export const DECLARED_ESTATE_KINDS: Readonly<Record<DeclaredEstateKind, DeclaredEstateKindDefinition>> = {
  workstations: { category: 'host', subcategories: ['workstation', 'laptop'], exposable: false, virtualSubcategory: 'workstation' },
  mobile_devices: { category: 'mobile_device', subcategories: null, exposable: false, virtualSubcategory: null },
  people: { category: 'identity', subcategories: ['user_account'], exposable: false, virtualSubcategory: 'user_account' },
  servers: {
    category: 'host',
    subcategories: ['server', 'virtual_machine', 'hypervisor', 'mainframe', 'thin_client'],
    exposable: true,
    virtualSubcategory: 'server',
  },
  containers: { category: 'container_workload', subcategories: null, exposable: true, virtualSubcategory: null },
  cloud_resources: { category: 'cloud_resource', subcategories: null, exposable: true, virtualSubcategory: null },
  service_accounts: { category: 'identity', subcategories: ['service_account', 'non_human_identity'], exposable: false, virtualSubcategory: 'service_account' },
  web_applications: { category: 'web_application', subcategories: null, exposable: true, virtualSubcategory: null },
  saas_applications: { category: 'saas_application', subcategories: null, exposable: false, virtualSubcategory: null },
  ai_systems: { category: 'ai_target', subcategories: null, exposable: true, virtualSubcategory: null },
  network_devices: { category: 'network_device', subcategories: null, exposable: true, virtualSubcategory: null },
  iot_ot_devices: { category: 'iot_ot_device', subcategories: null, exposable: false, virtualSubcategory: null },
};

/** A disabled account is no person, as the door reads it. */
export const declaredEstateKindOf = (
  category: AssetCategory,
  subcategory: AssetSubcategory | null,
  identityEnabled: boolean,
): DeclaredEstateKind | null => {
  if (category === 'host' && subcategory === null) {
    return 'workstations';
  }
  for (const kind of DECLARED_ESTATE_KIND_VALUES) {
    const definition = DECLARED_ESTATE_KINDS[kind];
    if (definition.category !== category) {
      continue;
    }
    if (definition.subcategories === null) {
      return kind;
    }
    if (subcategory !== null && definition.subcategories.includes(subcategory)) {
      return kind === 'people' && !identityEnabled ? null : kind;
    }
  }
  return null;
};

/** Large enough for any estate, small enough for a Postgres integer. */
export const DECLARED_ESTATE_MAX_COUNT = 10_000_000;

export const DECLARED_ESTATE_BAND_VALUES = ['none', '1_10', '11_50', '51_250', '251_1000', '1001_5000', 'over_5000'] as const;
export type DeclaredEstateBand = (typeof DECLARED_ESTATE_BAND_VALUES)[number];

/**
 * The bands are shortcuts to a pair of bounds, each about five times the one before. The last one
 * still has a high bound, five times its low one: past it the answer is an exact number or a range.
 */
export const DECLARED_ESTATE_BANDS: Readonly<Record<DeclaredEstateBand, { readonly low: number, readonly high: number }>> = {
  none: { low: 0, high: 0 },
  '1_10': { low: 1, high: 10 },
  '11_50': { low: 11, high: 50 },
  '51_250': { low: 51, high: 250 },
  '251_1000': { low: 251, high: 1000 },
  '1001_5000': { low: 1001, high: 5000 },
  over_5000: { low: 5001, high: 25_000 },
};

export const declaredEstateBandOf = (low: number, high: number): DeclaredEstateBand | null =>
  DECLARED_ESTATE_BAND_VALUES.find((band) => DECLARED_ESTATE_BANDS[band].low === low && DECLARED_ESTATE_BANDS[band].high === high) ?? null;
