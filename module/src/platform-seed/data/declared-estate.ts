import type { DeclaredEstateKind } from '../../modules/declared-estate/constants';

/**
 * Acme's workstations and servers are exact numbers, which price its incident response and
 * restoration losses at one count each. Every other low bound is at or under what the seeded assets
 * measure.
 */
export const acmeCorpDeclaredEstate: ReadonlyArray<{ kind: DeclaredEstateKind, low: number, high: number, internetFacing: boolean | null }> = [
  { kind: 'workstations', low: 4_200, high: 4_200, internetFacing: null },
  { kind: 'people', low: 1, high: 10, internetFacing: null },
  { kind: 'servers', low: 180, high: 180, internetFacing: false },
  { kind: 'web_applications', low: 1, high: 10, internetFacing: true },
  { kind: 'network_devices', low: 2, high: 5, internetFacing: null },
  { kind: 'saas_applications', low: 1, high: 10, internetFacing: null },
];
