import { Capability_ManageSecurity } from './capabilities-ids';

export interface CapabilityReference {
  id: string,
  name: string,
}

/**
 * The tenant capability catalog, reprovisioned on every boot.
 * `name` is the stable code the security policies read; the frontend translates it for display.
 */
export const CAPABILITIES: ReadonlyArray<CapabilityReference> = [
  { id: Capability_ManageSecurity, name: 'MANAGE_SECURITY' },
];
