import { and, eq, sql } from 'drizzle-orm';
import type { CatalogNodeRow, ParsedCatalog } from './oscal-catalog';
import type { ControlLinkRow } from './oscal-mapping';
import { chunk } from '../../../seed-batch';
import { registerSeed } from '../../../seed-registry';
// Through the barrel, so the capability seeds register, and run, before this one: the links
// reference the controls.
import { controlCapabilitiesData } from '../../controls/capability/data';
import { complianceFrameworkNodes, complianceFrameworks, complianceRequirementControls } from '../schema';
// usnistgov/oscal-content, nist.gov/CSF/v2.0/json/NIST_CSF_v2.0_catalog.json at commit
// 78650f02ad9321bb7b817846f8fbd4f2bcd620de, unmodified. NIST's work, in the public domain.
import nistCsf20Catalog from './nist-csf-2.0-catalog.json';
// Emitted by an external generator: regenerated there, never edited here.
import nistCsf20ControlMapping from './nist-csf-2.0-control-mapping.json';
import { parseOscalCatalog } from './oscal-catalog';
import { parseOscalMapping } from './oscal-mapping';

export const NIST_CSF_2_0_KEY = 'nist-csf-2.0';

const nistCsf20 = parseOscalCatalog({ key: NIST_CSF_2_0_KEY, title: 'NIST CSF 2.0' }, nistCsf20Catalog);

export const BUNDLED_CATALOGS: ReadonlyArray<ParsedCatalog> = [nistCsf20];

/** The controls each requirement feeds, by framework id. */
export const BUNDLED_CONTROL_LINKS: ReadonlyMap<string, ReadonlyArray<ControlLinkRow>> = new Map([
  [nistCsf20.framework.id, parseOscalMapping(nistCsf20, controlCapabilitiesData, nistCsf20ControlMapping)],
]);

const linkKey = (link: { requirementId: string, capabilityId: string }) => `${link.requirementId}:${link.capabilityId}`;

const frameworkDiverged = sql`${complianceFrameworks.key} IS DISTINCT FROM excluded.key
  OR ${complianceFrameworks.title} IS DISTINCT FROM excluded.title
  OR ${complianceFrameworks.version} IS DISTINCT FROM excluded.version
  OR ${complianceFrameworks.oscalCatalogUuid} IS DISTINCT FROM excluded.oscal_catalog_uuid`;

const nodeDiverged = sql`${complianceFrameworkNodes.parentId} IS DISTINCT FROM excluded.parent_id
  OR ${complianceFrameworkNodes.code} IS DISTINCT FROM excluded.code
  OR ${complianceFrameworkNodes.title} IS DISTINCT FROM excluded.title
  OR ${complianceFrameworkNodes.statement} IS DISTINCT FROM excluded.statement
  OR ${complianceFrameworkNodes.kind} IS DISTINCT FROM excluded.kind
  OR ${complianceFrameworkNodes.isRequirement} IS DISTINCT FROM excluded.is_requirement
  OR ${complianceFrameworkNodes.position} IS DISTINCT FROM excluded.position`;

/** Rows grouped by depth, so a parent row always exists before the statement naming it. */
const byDepth = (nodes: ReadonlyArray<CatalogNodeRow>): Array<Array<CatalogNodeRow>> => {
  const depthOf = new Map<string, number>();
  const levels: Array<Array<CatalogNodeRow>> = [];
  for (const node of nodes) {
    const depth = node.parentId === null ? 0 : (depthOf.get(node.parentId) ?? 0) + 1;
    depthOf.set(node.id, depth);
    (levels[depth] ??= []).push(node);
  }
  return levels;
};

registerSeed(async (db) => {
  for (const { framework, nodes } of BUNDLED_CATALOGS) {
    await db.insert(complianceFrameworks).values(framework).onConflictDoUpdate({
      target: complianceFrameworks.id,
      set: {
        key: sql`excluded.key`,
        title: sql`excluded.title`,
        version: sql`excluded.version`,
        oscalCatalogUuid: sql`excluded.oscal_catalog_uuid`,
      },
      setWhere: frameworkDiverged,
    });
    for (const level of byDepth(nodes)) {
      for (const rows of chunk(level)) {
        await db.insert(complianceFrameworkNodes).values(rows).onConflictDoUpdate({
          target: complianceFrameworkNodes.id,
          set: {
            parentId: sql`excluded.parent_id`,
            code: sql`excluded.code`,
            title: sql`excluded.title`,
            statement: sql`excluded.statement`,
            kind: sql`excluded.kind`,
            isRequirement: sql`excluded.is_requirement`,
            position: sql`excluded.position`,
          },
          setWhere: nodeDiverged,
        });
      }
    }

    const links = BUNDLED_CONTROL_LINKS.get(framework.id) ?? [];
    for (const rows of chunk(links)) {
      await db.insert(complianceRequirementControls).values(rows).onConflictDoUpdate({
        target: [complianceRequirementControls.requirementId, complianceRequirementControls.capabilityId],
        set: { axis: sql`excluded.axis` },
        setWhere: sql`${complianceRequirementControls.axis} IS DISTINCT FROM excluded.axis`,
      });
    }
    const curated = new Set(links.map(linkKey));
    const existing = await db.select({
      requirementId: complianceRequirementControls.requirementId,
      capabilityId: complianceRequirementControls.capabilityId,
    })
      .from(complianceRequirementControls)
      .innerJoin(complianceFrameworkNodes, eq(complianceRequirementControls.requirementId, complianceFrameworkNodes.id))
      .where(eq(complianceFrameworkNodes.frameworkId, framework.id));
    for (const stale of existing.filter((link) => !curated.has(linkKey(link)))) {
      await db.delete(complianceRequirementControls).where(and(
        eq(complianceRequirementControls.requirementId, stale.requirementId),
        eq(complianceRequirementControls.capabilityId, stale.capabilityId),
      ));
    }
  }
});
