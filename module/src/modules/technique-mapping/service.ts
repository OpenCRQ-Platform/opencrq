import { uuidv7 } from 'uuidv7';
import type { MappingRole } from './data/curated-technique-mappings';
import type { MappingLane, TechniqueGrain, TechniqueResolutionState } from './constants';
import type { cveTechniqueMapping, cveTechniqueResolution } from './schema';
import { defineService } from '../../registry';
import { cveService } from '../cve/service';
import { cweService } from '../cwe/service';
import { MAPPING_ROLES, TECHNIQUE_TABLES_PROVENANCE } from './data';
import { techniqueMappingRepository } from './repository';
import { keepStrongestLane, resolveTechniques } from './technique-resolver';
import { TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS } from './topology-rule';

type ResolutionInsert = typeof cveTechniqueResolution.$inferInsert;

/** The lane the weakness link's claims carry, and with it the confidence the score gives them. */
const WEAKNESS_LINK_LANE: MappingLane = 'structural';
const WEAKNESS_LINK_ROLE: MappingRole = 'exploitation_technique';

interface TechniqueClaimRow {
  cveId: string,
  mitreTechniqueId: string,
  role: MappingRole,
  lane: MappingLane,
  grain: TechniqueGrain,
  techniqueExternalId: string,
  techniqueName: string,
  /** The CVE's weaknesses whose effective link names the technique, empty on a stored claim. */
  weaknesses: Array<string>,
}
type MappingInsert = typeof cveTechniqueMapping.$inferInsert;

/**
 * Every upsert on a vulnerability row bumps its update timestamp, whichever feed wrote it, so the
 * timestamp only says a recomputation may be due. Whether it is due is settled by `sameAnswer`.
 */
const isStale = (
  current: { tablesVersion: string, resolvedAt: Date } | undefined,
  cveUpdatedAt: Date,
  tablesVersion: string,
): boolean => current === undefined
  || current.tablesVersion !== tablesVersion
  || current.resolvedAt.getTime() < cveUpdatedAt.getTime();

interface MappingKey {
  readonly mitreTechniqueId: string,
  readonly role: MappingRole,
  readonly lane: MappingLane,
}

const mappingKeys = (rows: ReadonlyArray<MappingKey>): Set<string> =>
  new Set(rows.map((row) => `${row.mitreTechniqueId}|${row.role}|${row.lane}`));

/**
 * The grain is a property of the technique, not of the resolution, so the three fields that can
 * change an answer are the technique, the role and the lane that claims it.
 */
const sameAnswer = (
  current: { state: TechniqueResolutionState, tablesVersion: string } | undefined,
  currentRows: ReadonlyArray<MappingKey>,
  next: { state: TechniqueResolutionState, tablesVersion: string },
  nextRows: ReadonlyArray<MappingKey>,
): boolean => {
  if (current === undefined || current.state !== next.state || current.tablesVersion !== next.tablesVersion) {
    return false;
  }
  const currentKeys = mappingKeys(currentRows);
  const nextKeys = mappingKeys(nextRows);
  return currentKeys.size === nextKeys.size && [...nextKeys].every((key) => currentKeys.has(key));
};

export const techniqueMappingService = defineService(
  'techniqueMapping',
  techniqueMappingRepository,
).dependsOn(() => [cveService, cweService]).implement({
  /**
   * The claims on a set of tenant CVE rows: the stored ones, and the tenant's effective weakness
   * link for each CVE's weaknesses, read now so a tenant edit reaches every finding at once, with
   * what `readAttackClaims` needs to finish the answer for a given asset. Mappings come in
   * published order (exploitation before impacts, alphabetical within a role). A CVE absent from
   * `states` was never resolved and its weaknesses link to nothing, which is not the same claim
   * as a row whose state is `unresolved`.
   */
  getTechniqueClaims: async ({ repo, deps }, cveRowIds: Array<string>) => {
    const ids = [...new Set(cveRowIds)];
    const [resolutions, stored, cves, ruleCatalogue] = await Promise.all([
      repo.findResolutionsByCveIds(ids),
      repo.findMappingsByCveIds(ids),
      deps.cve.getTechniqueResolverInputs(ids),
      repo.findTechniquesByExternalIds([...TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS]),
    ]);

    const linked = new Map<string, TechniqueClaimRow>();
    for (const [tenantId, tenantCves] of Map.groupBy(cves.filter((row) => row.cwe !== null), (row) => row.tenantId)) {
      const byCwe = await deps.cwe.getEffectiveTechniques(tenantId, tenantCves.flatMap((row) => row.cwe ?? []));
      for (const row of tenantCves) {
        for (const cweId of row.cwe ?? []) {
          for (const technique of byCwe.get(cweId) ?? []) {
            const key = `${row.id}|${technique.techniqueId}`;
            const claim = linked.get(key) ?? {
              cveId: row.id,
              mitreTechniqueId: technique.techniqueId,
              role: WEAKNESS_LINK_ROLE,
              lane: WEAKNESS_LINK_LANE,
              grain: technique.isSubtechnique ? 'sub_technique' : 'parent',
              techniqueExternalId: technique.externalId,
              techniqueName: technique.name,
              weaknesses: [],
            };
            claim.weaknesses.push(cweId);
            linked.set(key, claim);
          }
        }
      }
    }

    const claimRows: Array<TechniqueClaimRow> = [...stored.map((row) => ({ ...row, weaknesses: [] })), ...linked.values()];
    const mappings = [...Map.groupBy(claimRows, (row) => row.cveId).values()].flatMap(keepStrongestLane);
    const linkedCveIds = new Set([...linked.values()].map((row) => row.cveId));
    const stateByCveId = new Map(resolutions.map(({ cveId, state }) => [cveId, state]));
    for (const cveId of linkedCveIds) {
      stateByCveId.set(cveId, 'resolved');
    }
    return {
      states: [...stateByCveId].map(([cveId, state]) => ({ cveId, state })),
      mappings: mappings.sort((left, right) => {
        const byRole = MAPPING_ROLES.indexOf(left.role) - MAPPING_ROLES.indexOf(right.role);
        if (byRole !== 0) {
          return byRole;
        }
        return left.techniqueExternalId.localeCompare(right.techniqueExternalId);
      }),
      cves: cves.map(({ id, cwe, cvssVector, cvssV2UserInteractionRequired }) => ({
        cveRowId: id,
        cwe,
        cvssVector,
        cvssV2UserInteractionRequired,
      })),
      ruleCatalogue: new Map(ruleCatalogue.map((technique) => [technique.externalId, technique])),
    };
  },

  /**
   * Called from inside the finding write's transaction, so the rows land or roll back with the
   * findings that asked for them, and from the vulnerability feed sync after it enriches a page,
   * which is how a resolution made on a shell row converges once its weakness class arrives.
   * Idempotent: an unchanged answer is not rewritten, so callers need not ration the call.
   */
  resolveTechniquesForCves: async ({ repo, deps, atomic }, cveRowIds: Array<string>) => {
    const ids = [...new Set(cveRowIds)];
    if (ids.length === 0) {
      return;
    }

    const inputs = await deps.cve.getTechniqueResolverInputs(ids);
    if (inputs.length === 0) {
      return;
    }

    const tablesVersion = TECHNIQUE_TABLES_PROVENANCE.tablesVersion;
    const currentByCveId = new Map(
      (await repo.findResolutionsByCveIds(ids)).map((resolution) => [resolution.cveId, resolution]),
    );
    const stale = inputs.filter((input) => isStale(currentByCveId.get(input.id), input.updatedAt, tablesVersion));
    if (stale.length === 0) {
      return;
    }

    const resolved = stale.map((input) => ({
      input,
      techniques: resolveTechniques({ cveId: input.cveId }),
    }));

    const externalIds = [...new Set(resolved.flatMap(({ techniques }) => techniques.map((t) => t.techniqueExternalId)))];
    // Sequential, not `Promise.all`: the platform seed calls this on its transaction's one connection.
    const catalogue = await repo.findTechniquesByExternalIds(externalIds);
    const currentMappings = await repo.findMappingsByCveIds(stale.map((input) => input.id));
    const catalogueByExternalId = new Map(catalogue.map((technique) => [technique.externalId, technique]));
    const currentRowsByCveId = Map.groupBy(currentMappings, (row) => row.cveId);

    // Same statement snapshot as the `updatedAt` staleness check just above, so both sides of a
    // future comparison come from the database's clock rather than racing against the app server's.
    const resolvedAt = stale[0].serverNow;
    const changedCveIds: Array<string> = [];
    const resolutions: Array<ResolutionInsert> = [];
    const mappings: Array<MappingInsert> = [];

    for (const { input, techniques } of resolved) {
      const resolutionId = uuidv7();
      const rows = techniques.flatMap((technique): Array<MappingInsert> => {
        const catalogueRow = catalogueByExternalId.get(technique.techniqueExternalId);
        // Every identifier the vendored tables cite resolves in the catalogue, so only a supplied
        // row could miss. Dropping beats writing a dangling reference, which would leave the
        // finding looking mapped and joining to nothing.
        if (catalogueRow === undefined) {
          return [];
        }
        const grain: TechniqueGrain = catalogueRow.isSubtechnique ? 'sub_technique' : 'parent';
        return [{
          id: uuidv7(),
          tenantId: input.tenantId,
          resolutionId,
          cveId: input.id,
          mitreTechniqueId: catalogueRow.id,
          role: technique.role,
          lane: technique.lane,
          grain,
          tablesVersion,
        }];
      });

      const resolution: ResolutionInsert = {
        id: resolutionId,
        tenantId: input.tenantId,
        cveId: input.id,
        state: rows.length > 0 ? 'resolved' : 'unresolved',
        tablesVersion,
        resolvedAt,
      };
      if (sameAnswer(currentByCveId.get(input.id), currentRowsByCveId.get(input.id) ?? [], resolution, rows)) {
        continue;
      }
      changedCveIds.push(input.id);
      resolutions.push(resolution);
      mappings.push(...rows);
    }

    if (changedCveIds.length === 0) {
      return;
    }
    await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.replaceResolutions(changedCveIds, resolutions, mappings);
    });
  },
});
