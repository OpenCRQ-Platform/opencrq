import { newError } from '@app/utils';
import type { CweLinkEntryState } from './constants';
import type { CweLinkJustification } from './effective-link';
import { defineService } from '../../registry';
import { requireClientTenantId, requireTenantId } from '../../security';
import { isEffectiveEntry, resolveEffectiveLink } from './effective-link';
import { cweRepository } from './repository';

export interface CweCatalogueEntry {
  externalId: string,
  name: string,
  techniqueCount: number,
  /** The tenant changed this weakness's link, so it no longer follows every shipped version as is. */
  modified: boolean,
  presentInFindings: boolean,
}

export interface CweTechniqueEntry {
  techniqueId: string,
  externalId: string,
  name: string,
  state: CweLinkEntryState,
  justifications: Array<CweLinkJustification>,
}

export interface CweDetail {
  externalId: string,
  name: string,
  description: string,
  techniques: Array<CweTechniqueEntry>,
  /** The stored edits Reset discards, more than the added and removed entries once a shipped version absorbs or drops one. */
  overrideCount: number,
}

export interface CweEffectiveTechnique {
  techniqueId: string,
  externalId: string,
  name: string,
  isSubtechnique: boolean,
}

const STATE_ORDER: ReadonlyArray<CweLinkEntryState> = ['shipped', 'added', 'removed'];

const byNumber = (left: string, right: string): number => left.localeCompare(right, undefined, { numeric: true });

export const cweService = defineService('cwe', cweRepository).implement({
  /** Every live weakness, flagged; the page filters, since the whole catalogue is under a thousand rows. */
  listCatalogue: async ({ repo, eventOrigin }): Promise<Array<CweCatalogueEntry>> => {
    const tenantId = requireTenantId(eventOrigin);
    const [weaknesses, shipped, overrides, cweLists] = await Promise.all([
      repo.findWeaknesses(),
      repo.findShippedLinkRows(),
      repo.findOverrides(tenantId),
      repo.findCweListsOfCvesWithFindings(),
    ]);
    const counts = new Map<string, number>();
    for (const entry of resolveEffectiveLink(shipped, overrides).filter(isEffectiveEntry)) {
      counts.set(entry.cweId, (counts.get(entry.cweId) ?? 0) + 1);
    }
    const modified = new Set(overrides.map((override) => override.cweId));
    const present = new Set(cweLists.flatMap((row) => row.cwe ?? []));
    return weaknesses
      .map((weakness) => ({
        externalId: weakness.externalId,
        name: weakness.name,
        techniqueCount: counts.get(weakness.id) ?? 0,
        modified: modified.has(weakness.id),
        presentInFindings: present.has(weakness.externalId),
      }))
      .sort((left, right) => byNumber(left.externalId, right.externalId));
  },

  getCwe: async ({ repo, eventOrigin }, externalId: string): Promise<CweDetail> => {
    const tenantId = requireTenantId(eventOrigin);
    const weakness = await repo.findWeaknessByExternalId(externalId);
    if (weakness === undefined) {
      throw newError('Not Found');
    }
    const [shipped, overrides] = await Promise.all([
      repo.findShippedLinkRows([weakness.id]),
      repo.findOverrides(tenantId, [weakness.id]),
    ]);
    const entries = resolveEffectiveLink(shipped, overrides);
    const techniques = new Map((await repo.findTechniques(entries.map((entry) => entry.techniqueId)))
      .map((technique) => [technique.id, technique]));
    return {
      externalId: weakness.externalId,
      name: weakness.name,
      description: weakness.description,
      overrideCount: overrides.length,
      techniques: entries
        .flatMap((entry) => {
          const technique = techniques.get(entry.techniqueId);
          return technique === undefined ? [] : [{
            techniqueId: entry.techniqueId,
            externalId: technique.externalId,
            name: technique.name,
            state: entry.state,
            justifications: [...entry.justifications],
          }];
        })
        .sort((left, right) => STATE_ORDER.indexOf(left.state) - STATE_ORDER.indexOf(right.state)
          || byNumber(left.externalId, right.externalId)),
    };
  },

  getEffectiveTechniques: async (
    { repo },
    tenantId: string,
    cweExternalIds: Array<string>,
  ): Promise<Map<string, Array<CweEffectiveTechnique>>> => {
    const weaknesses = await repo.findWeaknessIdsByExternalIds([...new Set(cweExternalIds)]);
    if (weaknesses.length === 0) {
      return new Map();
    }
    const ids = weaknesses.map((weakness) => weakness.id);
    const [shipped, overrides] = await Promise.all([
      repo.findShippedLinkRows(ids),
      repo.findOverrides(tenantId, ids),
    ]);
    const entries = resolveEffectiveLink(shipped, overrides).filter(isEffectiveEntry);
    const techniques = new Map((await repo.findTechniques([...new Set(entries.map((entry) => entry.techniqueId))]))
      .map((technique) => [technique.id, technique]));
    const externalIdById = new Map(weaknesses.map((weakness) => [weakness.id, weakness.externalId]));
    const byCwe = new Map<string, Array<CweEffectiveTechnique>>();
    for (const entry of entries) {
      const technique = techniques.get(entry.techniqueId);
      const cweExternalId = externalIdById.get(entry.cweId);
      if (technique === undefined || cweExternalId === undefined) {
        continue;
      }
      const list = byCwe.get(cweExternalId) ?? [];
      list.push({ techniqueId: technique.id, externalId: technique.externalId, name: technique.name, isSubtechnique: technique.isSubtechnique });
      byCwe.set(cweExternalId, list);
    }
    return byCwe;
  },

  addTechnique: async ({ atomic, eventOrigin }, cweExternalId: string, techniqueId: string) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await atomic(async ({ repo }) => {
      const weakness = await repo.findWeaknessByExternalId(cweExternalId);
      if (weakness === undefined) {
        throw newError('Not Found');
      }
      await repo.validateTechniqueId(techniqueId);
      const shipped = await repo.findShippedLinkRows([weakness.id]);
      const overrides = await repo.findOverrides(tenantId, [weakness.id]);
      // A technique the shipped link carries is never added on top of it: a tenant that removed it
      // restores it instead.
      if (shipped.some((row) => row.techniqueId === techniqueId) || overrides.some((row) => row.techniqueId === techniqueId)) {
        throw newError('Technique already linked');
      }
      await repo.upsertOverride({ tenantId, cweId: weakness.id, techniqueId }, 'added');
    });
  },

  removeTechnique: async ({ atomic, eventOrigin }, cweExternalId: string, techniqueId: string) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await atomic(async ({ repo }) => {
      const weakness = await repo.findWeaknessByExternalId(cweExternalId);
      if (weakness === undefined) {
        throw newError('Not Found');
      }
      const shipped = await repo.findShippedLinkRows([weakness.id]);
      const overrides = await repo.findOverrides(tenantId, [weakness.id]);
      const existing = overrides.find((row) => row.techniqueId === techniqueId);
      // Removing an addition erases it: there is no removed addition to restore from.
      if (existing?.kind === 'added') {
        await repo.deleteOverride({ tenantId, cweId: weakness.id, techniqueId });
        return;
      }
      if (existing?.kind === 'removed') {
        return;
      }
      if (!shipped.some((row) => row.techniqueId === techniqueId)) {
        throw newError('Not Found');
      }
      await repo.upsertOverride({ tenantId, cweId: weakness.id, techniqueId }, 'removed');
    });
  },

  restoreTechnique: async ({ atomic, eventOrigin }, cweExternalId: string, techniqueId: string) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await atomic(async ({ repo }) => {
      const weakness = await repo.findWeaknessByExternalId(cweExternalId);
      if (weakness === undefined) {
        throw newError('Not Found');
      }
      const overrides = await repo.findOverrides(tenantId, [weakness.id]);
      if (overrides.find((row) => row.techniqueId === techniqueId)?.kind !== 'removed') {
        throw newError('Not Found');
      }
      await repo.deleteOverride({ tenantId, cweId: weakness.id, techniqueId });
    });
  },

  resetCwe: async ({ atomic, eventOrigin }, cweExternalId: string) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await atomic(async ({ repo }) => {
      const weakness = await repo.findWeaknessByExternalId(cweExternalId);
      if (weakness === undefined) {
        throw newError('Not Found');
      }
      await repo.deleteOverridesForCwe(tenantId, weakness.id);
    });
  },
});
