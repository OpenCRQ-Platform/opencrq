import type { CweLinkEntryState, CweLinkOverrideKind } from './constants';
import type { CweLinkJustificationKind } from './data/cwe-technique-link';

export interface ShippedLinkRow {
  readonly cweId: string,
  readonly techniqueId: string,
  readonly justificationKind: CweLinkJustificationKind,
  readonly justificationRef: string,
  readonly justificationName: string | null,
}

export interface CweLinkOverride {
  readonly cweId: string,
  readonly techniqueId: string,
  readonly kind: CweLinkOverrideKind,
}

export interface CweLinkJustification {
  readonly kind: CweLinkJustificationKind,
  readonly ref: string,
  readonly name: string | null,
}

/**
 * One technique of a weakness's effective link. `removed` entries stay in the list so the page
 * keeps showing what the platform ships and the tenant took out.
 */
export interface EffectiveLinkEntry {
  readonly cweId: string,
  readonly techniqueId: string,
  readonly state: CweLinkEntryState,
  /** Empty on a technique the tenant added. */
  readonly justifications: ReadonlyArray<CweLinkJustification>,
}

const key = (cweId: string, techniqueId: string): string => `${cweId}:${techniqueId}`;

/**
 * Effective link = shipped link − tenant removals + tenant additions, and the only place the two
 * are combined.
 *
 * An addition the shipped link now carries reports `shipped`, so a shipped version that starts
 * linking an added technique never yields it twice. A removal of a technique the shipped link no
 * longer carries yields nothing: there is nothing left to restore.
 */
export const resolveEffectiveLink = (
  shipped: ReadonlyArray<ShippedLinkRow>,
  overrides: ReadonlyArray<CweLinkOverride>,
): Array<EffectiveLinkEntry> => {
  const removed = new Set(overrides.filter((o) => o.kind === 'removed').map((o) => key(o.cweId, o.techniqueId)));
  const shippedByKey = new Map<string, { cweId: string, techniqueId: string, justifications: Array<CweLinkJustification> }>();
  for (const row of shipped) {
    const rowKey = key(row.cweId, row.techniqueId);
    const entry = shippedByKey.get(rowKey) ?? { cweId: row.cweId, techniqueId: row.techniqueId, justifications: [] };
    entry.justifications.push({ kind: row.justificationKind, ref: row.justificationRef, name: row.justificationName });
    shippedByKey.set(rowKey, entry);
  }

  const resolved: Array<EffectiveLinkEntry> = [...shippedByKey.entries()].map(([rowKey, entry]) => ({
    ...entry,
    state: removed.has(rowKey) ? 'removed' : 'shipped',
  }));
  for (const override of overrides) {
    if (override.kind === 'added' && !shippedByKey.has(key(override.cweId, override.techniqueId))) {
      resolved.push({ cweId: override.cweId, techniqueId: override.techniqueId, state: 'added', justifications: [] });
    }
  }
  return resolved;
};

export const isEffectiveEntry = (entry: EffectiveLinkEntry): boolean => entry.state !== 'removed';
