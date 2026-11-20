import type { CweLinkJustificationKind } from './data/cwe-technique-link';

export const CWE_LINK_JUSTIFICATION_KINDS = ['attack_pattern', 'consequence'] as const satisfies ReadonlyArray<CweLinkJustificationKind>;

export const CWE_LINK_OVERRIDE_KINDS = ['added', 'removed'] as const;
export type CweLinkOverrideKind = (typeof CWE_LINK_OVERRIDE_KINDS)[number];

/** `shipped` is a technique the platform ships that the tenant kept, `removed` one it took out. */
export const CWE_LINK_ENTRY_STATES = ['shipped', 'added', 'removed'] as const;
export type CweLinkEntryState = (typeof CWE_LINK_ENTRY_STATES)[number];
