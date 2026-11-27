import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, min, ne, or, sql } from 'drizzle-orm';
import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type {
  AssessmentAxis,
  AssessmentMode,
  CapabilityFunction,
  ControlDomain,
  CoverageBasis,
  CoverageBucket,
  EffectiveEdgeSource,
  EffectiveEdgeState,
  StrengthRung,
  TechniqueOverrideKind,
} from './constants';
import type { CapabilityEdgeInput, CapabilityResistanceInputs, CapabilityStateInput, ScenarioNodeInput } from './susceptibility-engine';
import { LATERAL_ON } from '../../../db/lateral';
import { defineRepository } from '../../../registry';
import { orderByFolded } from '../../../db/fold-text';
import { isScoredEdge, preferDirectEdges, resolveEffectiveEdges } from './effective-coverage';
import {
  controlCapabilityAssessmentEvents,
  controlCapabilityAssessmentEventSources,
  controlCapabilityAssessments,
  controlCapabilityAssessmentSources,
  controlCapabilityScopeOverrides,
  controlCapabilityTechniqueOverrides,
} from './schema';

export interface AssessmentValue {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  strengthMode: AssessmentMode,
  coverageMode: AssessmentMode,
  coverageBasis: CoverageBasis,
  comment: string | null,
}

type AssessmentKey = { capabilityId: string, tenantId: string };

export interface AssessmentSourceRow {
  assessmentId: string,
  axis: AssessmentAxis,
  source: string,
}

interface AssessmentProvenance {
  at: Date | null,
  by: { userId: string, name: string | null } | null,
  connector: string | null,
}

interface CapabilityListRow {
  id: string,
  externalId: string,
  name: string,
  description: string,
  domain: ControlDomain,
  position: number,
  assessment: AssessmentValue | null,
  lastAssessedAt: Date | null,
  lastAssessedBy: { userId: string, name: string | null } | null,
  lastAssessedConnector: string | null,
}

interface TechniqueCapabilityRow {
  id: string,
  externalId: string,
  name: string,
  function: CapabilityFunction,
  source: EffectiveEdgeSource,
  state: EffectiveEdgeState,
  assessment: AssessmentValue | null,
  /** The parent technique the edge is carried by, null when the technique carries it itself. */
  inheritedFrom: { id: string, externalId: string, name: string } | null,
}

const toAssessment = (
  assessment: { [K in keyof AssessmentValue]: AssessmentValue[K] | null } | null,
): AssessmentValue | null =>
  assessment !== null && assessment.strengthRung !== null && assessment.coverageBucket !== null
    ? {
      strengthRung: assessment.strengthRung,
      coverageBucket: assessment.coverageBucket,
      strengthMode: assessment.strengthMode ?? 'manual',
      coverageMode: assessment.coverageMode ?? 'manual',
      coverageBasis: assessment.coverageBasis ?? 'declared',
      comment: assessment.comment,
    }
    : null;

const toProvenance = (
  event: { createdAt: Date | null, userId: string | null, userName: string | null, connector: string | null } | undefined,
): AssessmentProvenance => {
  if (!event?.createdAt) {
    return { at: null, by: null, connector: null };
  }
  return {
    at: event.createdAt,
    by: event.userId === null ? null : { userId: event.userId, name: event.userName },
    connector: event.connector,
  };
};

export const controlCapabilityRepository = defineRepository({
  // ─── Engine inputs ───────────────────────────────────────────────────────────

  /**
   * Build the engine inputs for the given scenario technique nodes and tenant:
   * the nodes (with parent uuids for sub-technique grain), the contributing edges
   * (on the nodes AND their parents, for parent fallback), and each relevant
   * capability's declared state (absent assessment = L0 / L0 baseline).
   */
  queryCapabilityResistanceInputs: async (
    { db, views },
    scenarioTechniqueIds: Array<string>,
    tenantId: string,
  ): Promise<CapabilityResistanceInputs> => {
    if (scenarioTechniqueIds.length === 0) {
      return { nodes: [], edges: [], states: [] };
    }

    const nodeRows = await db
      .select({ id: views.mitreTechniques.id, parentTechniqueId: views.mitreTechniques.parentTechniqueId })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.id, scenarioTechniqueIds));
    const nodes: Array<ScenarioNodeInput> = nodeRows.map((r) => ({
      techniqueId: r.id,
      parentTechniqueId: r.parentTechniqueId,
    }));

    const candidateIds = [...new Set([
      ...scenarioTechniqueIds,
      ...nodeRows.map((r) => r.parentTechniqueId).filter((id): id is string => id !== null),
    ])];

    const [catalogueRows, overrideRows] = await Promise.all([
      db
        .select({
          capabilityId: views.controlCapabilityEdges.capabilityId,
          techniqueId: views.controlCapabilityEdges.mitreTechniqueId,
          function: views.controlCapabilityEdges.function,
        })
        .from(views.controlCapabilityEdges)
        .where(inArray(views.controlCapabilityEdges.mitreTechniqueId, candidateIds)),
      db
        .select({
          capabilityId: views.controlCapabilityTechniqueOverrides.capabilityId,
          techniqueId: views.controlCapabilityTechniqueOverrides.mitreTechniqueId,
          kind: views.controlCapabilityTechniqueOverrides.kind,
          function: views.controlCapabilityTechniqueOverrides.function,
        })
        .from(views.controlCapabilityTechniqueOverrides)
        .where(and(
          inArray(views.controlCapabilityTechniqueOverrides.mitreTechniqueId, candidateIds),
          eq(views.controlCapabilityTechniqueOverrides.tenantId, tenantId),
        )),
    ]);

    // Single resolution point: the tenant's overlay decides what the engine scores, so an
    // exclusion drops the technique and an addition brings it in.
    const edgeRows = resolveEffectiveEdges(catalogueRows, overrideRows).filter(isScoredEdge);

    if (edgeRows.length === 0) {
      return { nodes, edges: [], states: [] };
    }

    const capabilityIds = [...new Set(edgeRows.map((e) => e.capabilityId))];

    const assessmentRows = await db
      .select({
        capabilityId: views.controlCapabilityAssessments.capabilityId,
        strengthRung: views.controlCapabilityAssessments.strengthRung,
        coverageBucket: views.controlCapabilityAssessments.coverageBucket,
      })
      .from(views.controlCapabilityAssessments)
      .where(and(
        inArray(views.controlCapabilityAssessments.capabilityId, capabilityIds),
        eq(views.controlCapabilityAssessments.tenantId, tenantId),
      ));
    const assessmentByCapability = new Map(assessmentRows.map((a) => [a.capabilityId, a]));

    const states: Array<CapabilityStateInput> = capabilityIds.map((capabilityId) => {
      const assessment = assessmentByCapability.get(capabilityId);
      return {
        capabilityId,
        strengthRung: (assessment?.strengthRung ?? 'L0'),
        coverageBucket: assessment?.coverageBucket ?? 'L0',
      };
    });

    const edges: Array<CapabilityEdgeInput> = edgeRows.map((e) => ({
      capabilityId: e.capabilityId,
      techniqueId: e.techniqueId,
      function: e.function,
    }));

    return { nodes, edges, states };
  },

  // ─── Protected asset families ────────────────────────────────────────────────

  /**
   * The families each of the named controls materially protects, one row per pair. Platform
   * reference, the same for every tenant, so the read carries no tenant scoping.
   */
  findProtectedFamilies: ({ db, views }, capabilityIds: Array<string>) => db
    .select({
      capabilityId: views.controlCapabilityProtectedFamilies.capabilityId,
      categoryId: views.controlCapabilityProtectedFamilies.categoryId,
    })
    .from(views.controlCapabilityProtectedFamilies)
    .where(inArray(views.controlCapabilityProtectedFamilies.capabilityId, capabilityIds)),

  // ─── List / detail reads ─────────────────────────────────────────────────────

  findAllCapabilities: async ({ db, views }, tenantId?: string): Promise<Array<CapabilityListRow>> => {
    if (!tenantId) {
      return (await db
        .select()
        .from(views.controlCapabilities)
        .orderBy(asc(views.controlCapabilities.position)))
        .map((c) => ({ ...c, assessment: null, lastAssessedAt: null, lastAssessedBy: null, lastAssessedConnector: null }));
    }

    // Read per capability through `control_capability_assessment_events_cap_tenant_date_idx`.
    const latestEvent = db
      .select({
        createdAt: views.controlCapabilityAssessmentEvents.createdAt,
        userId: views.controlCapabilityAssessmentEvents.userId,
        connector: views.controlCapabilityAssessmentEvents.connector,
      })
      .from(views.controlCapabilityAssessmentEvents)
      .where(and(
        eq(views.controlCapabilityAssessmentEvents.capabilityId, views.controlCapabilities.id),
        eq(views.controlCapabilityAssessmentEvents.tenantId, tenantId),
        isNull(views.controlCapabilityAssessmentEvents.organizationId),
      ))
      .orderBy(desc(views.controlCapabilityAssessmentEvents.createdAt), desc(views.controlCapabilityAssessmentEvents.id))
      .limit(1)
      .as('latest_assessment_event');

    return (await db
      .select({
        id: views.controlCapabilities.id,
        externalId: views.controlCapabilities.externalId,
        name: views.controlCapabilities.name,
        description: views.controlCapabilities.description,
        domain: views.controlCapabilities.domain,
        position: views.controlCapabilities.position,
        assessment: {
          strengthRung: views.controlCapabilityAssessments.strengthRung,
          coverageBucket: views.controlCapabilityAssessments.coverageBucket,
          strengthMode: views.controlCapabilityAssessments.strengthMode,
          coverageMode: views.controlCapabilityAssessments.coverageMode,
          coverageBasis: views.controlCapabilityAssessments.coverageBasis,
          comment: views.controlCapabilityAssessments.comment,
        },
        lastAssessedAt: latestEvent.createdAt,
        lastAssessedByUserId: latestEvent.userId,
        lastAssessedByName: views.users.name,
        lastAssessedConnector: latestEvent.connector,
      })
      .from(views.controlCapabilities)
      .leftJoin(views.controlCapabilityAssessments, and(
        eq(views.controlCapabilityAssessments.capabilityId, views.controlCapabilities.id),
        eq(views.controlCapabilityAssessments.tenantId, tenantId),
      ))
      .leftJoinLateral(latestEvent, LATERAL_ON)
      .leftJoin(views.users, eq(views.users.id, latestEvent.userId))
      .orderBy(asc(views.controlCapabilities.position)))
      .map((row) => {
        const provenance = toProvenance({
          createdAt: row.lastAssessedAt,
          userId: row.lastAssessedByUserId,
          userName: row.lastAssessedByName,
          connector: row.lastAssessedConnector,
        });
        return {
          id: row.id,
          externalId: row.externalId,
          name: row.name,
          description: row.description,
          domain: row.domain,
          position: row.position,
          assessment: toAssessment(row.assessment),
          lastAssessedAt: provenance.at,
          lastAssessedBy: provenance.by,
          lastAssessedConnector: provenance.connector,
        };
      });
  },

  findCapabilityExternalId: async ({ db, views }, id: string) => db
    .select({ externalId: views.controlCapabilities.externalId })
    .from(views.controlCapabilities)
    .where(eq(views.controlCapabilities.id, id))
    .limit(1)
    .then((rows) => rows.at(0)?.externalId),

  findCapabilityById: async ({ db, views }, id: string, tenantId?: string) => {
    const cap = await db
      .select({
        id: views.controlCapabilities.id,
        externalId: views.controlCapabilities.externalId,
        name: views.controlCapabilities.name,
        description: views.controlCapabilities.description,
        domain: views.controlCapabilities.domain,
        position: views.controlCapabilities.position,
      })
      .from(views.controlCapabilities)
      .where(eq(views.controlCapabilities.id, id))
      .limit(1)
      .then((rows) => rows.at(0));

    if (!cap) {
      return undefined;
    }

    const latestTenantEvent = (tenant: string, derivedOnly: boolean) => db
      .select({
        createdAt: views.controlCapabilityAssessmentEvents.createdAt,
        userId: views.controlCapabilityAssessmentEvents.userId,
        userName: views.users.name,
        connector: views.controlCapabilityAssessmentEvents.connector,
      })
      .from(views.controlCapabilityAssessmentEvents)
      .leftJoin(views.users, eq(views.users.id, views.controlCapabilityAssessmentEvents.userId))
      .where(and(
        eq(views.controlCapabilityAssessmentEvents.capabilityId, id),
        eq(views.controlCapabilityAssessmentEvents.tenantId, tenant),
        isNull(views.controlCapabilityAssessmentEvents.organizationId),
        derivedOnly ? isNotNull(views.controlCapabilityAssessmentEvents.connector) : undefined,
      ))
      .orderBy(
        desc(views.controlCapabilityAssessmentEvents.createdAt),
        desc(views.controlCapabilityAssessmentEvents.id),
      )
      .limit(1)
      .then((rows) => toProvenance(rows.at(0)));

    const [assessment, provenance, derivedProvenance, sources, rungs, catalogueEdges, overrides, crosswalk, securityPlatformFamilies, protectedFamilies] = await Promise.all([
      tenantId
        ? db
          .select({
            strengthRung: views.controlCapabilityAssessments.strengthRung,
            coverageBucket: views.controlCapabilityAssessments.coverageBucket,
            strengthMode: views.controlCapabilityAssessments.strengthMode,
            coverageMode: views.controlCapabilityAssessments.coverageMode,
            coverageBasis: views.controlCapabilityAssessments.coverageBasis,
            comment: views.controlCapabilityAssessments.comment,
          })
          .from(views.controlCapabilityAssessments)
          .where(and(
            eq(views.controlCapabilityAssessments.capabilityId, id),
            eq(views.controlCapabilityAssessments.tenantId, tenantId),
          ))
          .limit(1)
          .then((rows) => toAssessment(rows.at(0) ?? null))
        : Promise.resolve(null),
      tenantId ? latestTenantEvent(tenantId, false) : Promise.resolve(toProvenance(undefined)),
      tenantId ? latestTenantEvent(tenantId, true) : Promise.resolve(toProvenance(undefined)),
      tenantId
        ? db
          .select({
            axis: views.controlCapabilityAssessmentSources.axis,
            source: views.controlCapabilityAssessmentSources.source,
            frameworkTitle: views.complianceFrameworks.title,
          })
          .from(views.controlCapabilityAssessmentSources)
          .innerJoin(views.controlCapabilityAssessments, eq(views.controlCapabilityAssessments.id, views.controlCapabilityAssessmentSources.assessmentId))
          .leftJoin(views.complianceFrameworks, eq(views.complianceFrameworks.key, views.controlCapabilityAssessmentSources.source))
          .where(and(
            eq(views.controlCapabilityAssessments.capabilityId, id),
            eq(views.controlCapabilityAssessments.tenantId, tenantId),
          ))
          .orderBy(asc(views.controlCapabilityAssessmentSources.source))
        : Promise.resolve([]),
      db
        .select({ rung: views.controlCapabilityStrengthRungLabels.rung, label: views.controlCapabilityStrengthRungLabels.label })
        .from(views.controlCapabilityStrengthRungLabels)
        .where(eq(views.controlCapabilityStrengthRungLabels.capabilityId, id))
        .orderBy(asc(views.controlCapabilityStrengthRungLabels.rung)),
      db
        .select({
          capabilityId: views.controlCapabilityEdges.capabilityId,
          techniqueId: views.controlCapabilityEdges.mitreTechniqueId,
          techniqueExternalId: views.controlCapabilityEdges.techniqueExternalId,
          techniqueName: views.mitreTechniques.name,
          function: views.controlCapabilityEdges.function,
        })
        .from(views.controlCapabilityEdges)
        .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.controlCapabilityEdges.mitreTechniqueId))
        .where(eq(views.controlCapabilityEdges.capabilityId, id))
        .orderBy(asc(views.controlCapabilityEdges.techniqueExternalId)),
      tenantId
        ? db
          .select({
            capabilityId: views.controlCapabilityTechniqueOverrides.capabilityId,
            techniqueId: views.controlCapabilityTechniqueOverrides.mitreTechniqueId,
            techniqueExternalId: views.mitreTechniques.externalId,
            techniqueName: views.mitreTechniques.name,
            kind: views.controlCapabilityTechniqueOverrides.kind,
            function: views.controlCapabilityTechniqueOverrides.function,
          })
          .from(views.controlCapabilityTechniqueOverrides)
          .innerJoin(views.mitreTechniques, eq(views.mitreTechniques.id, views.controlCapabilityTechniqueOverrides.mitreTechniqueId))
          .where(and(
            eq(views.controlCapabilityTechniqueOverrides.capabilityId, id),
            eq(views.controlCapabilityTechniqueOverrides.tenantId, tenantId),
          ))
        : Promise.resolve([]),
      db
        .select({ framework: views.controlCapabilityCrosswalk.framework, externalId: views.controlCapabilityCrosswalk.externalId })
        .from(views.controlCapabilityCrosswalk)
        .where(eq(views.controlCapabilityCrosswalk.capabilityId, id))
        .orderBy(asc(views.controlCapabilityCrosswalk.framework)),
      db
        .select({
          id: views.securityPlatformFamilies.id,
          name: views.securityPlatformFamilies.name,
          platformTypeKey: views.securityPlatformFamilies.platformTypeKey,
        })
        .from(views.securityPlatformFamilyControls)
        .innerJoin(views.securityPlatformFamilies, eq(views.securityPlatformFamilies.id, views.securityPlatformFamilyControls.familyId))
        .where(eq(views.securityPlatformFamilyControls.capabilityId, id))
        .orderBy(...orderByFolded(views.securityPlatformFamilies.nameFolded, views.securityPlatformFamilies.name, false)),
      // Catalogue reference, the same for every tenant, so the read carries no tenant scoping.
      db
        .select({ categoryId: views.controlCapabilityProtectedFamilies.categoryId })
        .from(views.controlCapabilityProtectedFamilies)
        .where(eq(views.controlCapabilityProtectedFamilies.capabilityId, id))
        .orderBy(asc(views.controlCapabilityProtectedFamilies.categoryId)),
    ]);

    const techniqueMeta = new Map(
      [...catalogueEdges, ...overrides].map((row) => [
        row.techniqueId,
        { techniqueExternalId: row.techniqueExternalId, techniqueName: row.techniqueName },
      ]),
    );

    const effectiveEdges = resolveEffectiveEdges(catalogueEdges, overrides);

    // Tactics attach after resolution, through their own query: technique to tactic is
    // many-to-many, so joining them into the edge selects would fan the edge rows out.
    const coveredTechniqueIds = [...new Set(effectiveEdges.map((edge) => edge.techniqueId))];
    const tacticRows = coveredTechniqueIds.length === 0
      ? []
      : await db
        .select({
          techniqueId: views.mitreTechniqueTactics.techniqueId,
          externalId: views.mitreTactics.externalId,
          name: views.mitreTactics.name,
          order: views.mitreTactics.order,
        })
        .from(views.mitreTechniqueTactics)
        .innerJoin(views.mitreTactics, eq(views.mitreTactics.id, views.mitreTechniqueTactics.tacticId))
        .where(inArray(views.mitreTechniqueTactics.techniqueId, coveredTechniqueIds))
        .orderBy(asc(views.mitreTactics.order));

    const tacticsByTechnique = new Map<string, Array<{ externalId: string, name: string, order: number }>>();
    for (const row of tacticRows) {
      const tactics = tacticsByTechnique.get(row.techniqueId) ?? [];
      tactics.push({ externalId: row.externalId, name: row.name, order: row.order });
      tacticsByTechnique.set(row.techniqueId, tactics);
    }

    const edges = effectiveEdges
      .map((edge) => ({
        techniqueId: edge.techniqueId,
        techniqueExternalId: techniqueMeta.get(edge.techniqueId)?.techniqueExternalId ?? '',
        techniqueName: techniqueMeta.get(edge.techniqueId)?.techniqueName ?? '',
        function: edge.function,
        source: edge.source,
        state: edge.state,
        tactics: tacticsByTechnique.get(edge.techniqueId) ?? [],
      }))
      .sort((a, b) => a.techniqueExternalId.localeCompare(b.techniqueExternalId));

    return {
      ...cap,
      assessment,
      lastAssessedAt: provenance.at,
      lastAssessedBy: provenance.by,
      lastAssessedConnector: provenance.connector,
      lastDerivedAt: derivedProvenance.at,
      lastDerivedBy: derivedProvenance.by,
      assessmentSources: sources,
      rungs,
      edges,
      crosswalk,
      securityPlatformFamilies,
      protectedFamilies: protectedFamilies.map((row) => row.categoryId),
    };
  },

  /**
   * The controls whose effective coverage names this technique, one row per (control, function).
   * A sub-technique also answers with the edges its parent carries, which is what the engine
   * scores for it, and each such row names the technique it comes from. Removed rows stay in,
   * the same way the control's own coverage keeps them visible.
   */
  findCapabilitiesForTechnique: async (
    { db, views },
    techniqueId: string,
    tenantId?: string,
  ): Promise<Array<TechniqueCapabilityRow>> => {
    const technique = (await db
      .select({ parentTechniqueId: views.mitreTechniques.parentTechniqueId })
      .from(views.mitreTechniques)
      .where(eq(views.mitreTechniques.id, techniqueId))
      .limit(1)).at(0);
    if (!technique) {
      return [];
    }
    const parentTechniqueId = technique.parentTechniqueId;
    const candidateIds = parentTechniqueId === null ? [techniqueId] : [techniqueId, parentTechniqueId];

    const [catalogueEdges, overrides] = await Promise.all([
      db
        .select({
          capabilityId: views.controlCapabilityEdges.capabilityId,
          techniqueId: views.controlCapabilityEdges.mitreTechniqueId,
          function: views.controlCapabilityEdges.function,
        })
        .from(views.controlCapabilityEdges)
        .where(inArray(views.controlCapabilityEdges.mitreTechniqueId, candidateIds)),
      tenantId
        ? db
          .select({
            capabilityId: views.controlCapabilityTechniqueOverrides.capabilityId,
            techniqueId: views.controlCapabilityTechniqueOverrides.mitreTechniqueId,
            kind: views.controlCapabilityTechniqueOverrides.kind,
            function: views.controlCapabilityTechniqueOverrides.function,
          })
          .from(views.controlCapabilityTechniqueOverrides)
          .where(and(
            inArray(views.controlCapabilityTechniqueOverrides.mitreTechniqueId, candidateIds),
            eq(views.controlCapabilityTechniqueOverrides.tenantId, tenantId),
          ))
        : Promise.resolve([]),
    ]);

    const edges = preferDirectEdges(resolveEffectiveEdges(catalogueEdges, overrides), techniqueId);
    if (edges.length === 0) {
      return [];
    }

    const capabilityIds = [...new Set(edges.map((edge) => edge.capabilityId))];
    const inheritsFromParent = parentTechniqueId !== null
      && edges.some((edge) => edge.techniqueId !== techniqueId);

    const [capabilityRows, assessmentRows, parentRows] = await Promise.all([
      db
        .select({
          id: views.controlCapabilities.id,
          externalId: views.controlCapabilities.externalId,
          name: views.controlCapabilities.name,
        })
        .from(views.controlCapabilities)
        .where(inArray(views.controlCapabilities.id, capabilityIds)),
      tenantId
        ? db
          .select({
            capabilityId: views.controlCapabilityAssessments.capabilityId,
            strengthRung: views.controlCapabilityAssessments.strengthRung,
            coverageBucket: views.controlCapabilityAssessments.coverageBucket,
            strengthMode: views.controlCapabilityAssessments.strengthMode,
            coverageMode: views.controlCapabilityAssessments.coverageMode,
            coverageBasis: views.controlCapabilityAssessments.coverageBasis,
            comment: views.controlCapabilityAssessments.comment,
          })
          .from(views.controlCapabilityAssessments)
          .where(and(
            inArray(views.controlCapabilityAssessments.capabilityId, capabilityIds),
            eq(views.controlCapabilityAssessments.tenantId, tenantId),
          ))
        : Promise.resolve([]),
      inheritsFromParent
        ? db
          .select({
            id: views.mitreTechniques.id,
            externalId: views.mitreTechniques.externalId,
            name: views.mitreTechniques.name,
          })
          .from(views.mitreTechniques)
          .where(eq(views.mitreTechniques.id, parentTechniqueId))
          .limit(1)
        : Promise.resolve([]),
    ]);

    const capabilityById = new Map(capabilityRows.map((row) => [row.id, row]));
    const assessmentByCapability = new Map(assessmentRows.map((row) => [row.capabilityId, row]));
    const parent = parentRows.at(0) ?? null;

    return edges
      .flatMap((edge) => {
        const capability = capabilityById.get(edge.capabilityId);
        if (!capability) {
          return [];
        }
        return [{
          id: capability.id,
          externalId: capability.externalId,
          name: capability.name,
          function: edge.function,
          source: edge.source,
          state: edge.state,
          assessment: toAssessment(assessmentByCapability.get(edge.capabilityId) ?? null),
          inheritedFrom: edge.techniqueId === techniqueId ? null : parent,
        }];
      })
      .sort((a, b) => a.externalId.localeCompare(b.externalId));
  },

  findCapabilityIdsByExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return new Map<string, string>();
    }
    const rows = await db
      .select({ id: views.controlCapabilities.id, externalId: views.controlCapabilities.externalId })
      .from(views.controlCapabilities)
      .where(inArray(views.controlCapabilities.externalId, externalIds));
    return new Map(rows.map((row) => [row.externalId, row.id]));
  },

  findCapabilityIds: async ({ db, views }) =>
    (await db
      .select({ id: views.controlCapabilities.id })
      .from(views.controlCapabilities)
      .orderBy(asc(views.controlCapabilities.externalId)))
      .map((row) => row.id),

  validateCapabilityId: async ({ db, views }, capabilityId: string) => {
    const result = await db
      .select({ id: views.controlCapabilities.id })
      .from(views.controlCapabilities)
      .where(eq(views.controlCapabilities.id, capabilityId))
      .limit(1);
    if (result.length === 0) {
      throw newError('Not Found');
    }
  },

  /**
   * Locks the row for the rest of the transaction, so a write that keeps the axis it does not own
   * as read cannot put back a value another write changed in between. Holds only inside `atomic`.
   */
  lockAssessmentForUpdate: async ({ db, views }, { capabilityId, tenantId }: AssessmentKey) =>
    db
      .select({
        id: views.controlCapabilityAssessments.id,
        strengthRung: views.controlCapabilityAssessments.strengthRung,
        coverageBucket: views.controlCapabilityAssessments.coverageBucket,
        strengthMode: views.controlCapabilityAssessments.strengthMode,
        coverageMode: views.controlCapabilityAssessments.coverageMode,
        coverageBasis: views.controlCapabilityAssessments.coverageBasis,
        comment: views.controlCapabilityAssessments.comment,
      })
      .from(views.controlCapabilityAssessments)
      .where(and(
        eq(views.controlCapabilityAssessments.capabilityId, capabilityId),
        eq(views.controlCapabilityAssessments.tenantId, tenantId),
      ))
      .limit(1)
      .for('update')
      .then((rows) => rows.at(0)),

  findAssessmentRows: ({ db, views }, tenantId: string) =>
    db
      .select({
        id: views.controlCapabilityAssessments.id,
        capabilityId: views.controlCapabilityAssessments.capabilityId,
        strengthRung: views.controlCapabilityAssessments.strengthRung,
        coverageBucket: views.controlCapabilityAssessments.coverageBucket,
        strengthMode: views.controlCapabilityAssessments.strengthMode,
        coverageMode: views.controlCapabilityAssessments.coverageMode,
        coverageBasis: views.controlCapabilityAssessments.coverageBasis,
      })
      .from(views.controlCapabilityAssessments)
      .where(eq(views.controlCapabilityAssessments.tenantId, tenantId)),

  findAssessmentSources: ({ db, views }, tenantId: string, assessmentId?: string): Promise<Array<AssessmentSourceRow>> =>
    db
      .select({
        assessmentId: views.controlCapabilityAssessmentSources.assessmentId,
        axis: views.controlCapabilityAssessmentSources.axis,
        source: views.controlCapabilityAssessmentSources.source,
      })
      .from(views.controlCapabilityAssessmentSources)
      .where(and(
        eq(views.controlCapabilityAssessmentSources.tenantId, tenantId),
        assessmentId === undefined ? undefined : eq(views.controlCapabilityAssessmentSources.assessmentId, assessmentId),
      )),

  /** An empty result means a concurrent first save created the row since the caller found none. */
  insertAssessmentValues: (
    { db },
    { capabilityId, tenantId }: AssessmentKey,
    values: AssessmentValue,
  ) =>
    db.insert(controlCapabilityAssessments)
      .values({ id: uuidv7(), capabilityId, tenantId, ...values })
      .onConflictDoNothing({ target: [controlCapabilityAssessments.capabilityId, controlCapabilityAssessments.tenantId] })
      .returning(),

  updateAssessmentValues: (
    { db },
    { capabilityId, tenantId }: AssessmentKey,
    values: AssessmentValue,
  ) =>
    db.update(controlCapabilityAssessments)
      .set(values)
      .where(and(
        eq(controlCapabilityAssessments.capabilityId, capabilityId),
        eq(controlCapabilityAssessments.tenantId, tenantId),
      ))
      .returning(),

  /**
   * The derivation's write, of the axes it owns only. The modes it read can be stale by the time
   * this commits, so the conflict update requires the row to still hold them: a declaration that
   * landed in between wins, and the empty result says nothing was written.
   */
  upsertDerivedAssessmentValues: (
    { db },
    { capabilityId, tenantId }: AssessmentKey,
    values: Omit<AssessmentValue, 'comment'>,
    expected: { strengthMode: AssessmentMode, coverageMode: AssessmentMode },
  ) => {
    const derivedAxes = {
      ...(expected.strengthMode === 'auto'
        ? { strengthRung: values.strengthRung }
        : {}),
      ...(expected.coverageMode === 'auto'
        ? { coverageBucket: values.coverageBucket, coverageBasis: values.coverageBasis }
        : {}),
    };
    return db.insert(controlCapabilityAssessments)
      .values({ id: uuidv7(), capabilityId, tenantId, ...values, comment: null })
      .onConflictDoUpdate({
        target: [controlCapabilityAssessments.capabilityId, controlCapabilityAssessments.tenantId],
        set: derivedAxes,
        setWhere: and(
          eq(controlCapabilityAssessments.strengthMode, expected.strengthMode),
          eq(controlCapabilityAssessments.coverageMode, expected.coverageMode),
        ),
      })
      .returning();
  },

  /** Only a row still derived on every axis goes: a declaration that landed in between keeps it. */
  deleteDerivedAssessment: ({ db }, { capabilityId, tenantId }: AssessmentKey) =>
    db.delete(controlCapabilityAssessments)
      .where(and(
        eq(controlCapabilityAssessments.capabilityId, capabilityId),
        eq(controlCapabilityAssessments.tenantId, tenantId),
        eq(controlCapabilityAssessments.strengthMode, 'auto'),
        eq(controlCapabilityAssessments.coverageMode, 'auto'),
      ))
      .returning(),

  /**
   * Drops the named derived axes to the floor the engine reads for an unassessed control, while they
   * stay derived so the next source feeds them again. Only axes still derived
   * are touched: a declaration that landed in between keeps its value.
   */
  clearDerivedAxes: (
    { db },
    { capabilityId, tenantId }: AssessmentKey,
    axes: ReadonlyArray<AssessmentAxis>,
  ) =>
    db.update(controlCapabilityAssessments)
      .set({
        ...(axes.includes('strength') ? { strengthRung: 'L0' as const } : {}),
        ...(axes.includes('coverage') ? { coverageBucket: 'L0' as const } : {}),
      })
      .where(and(
        eq(controlCapabilityAssessments.capabilityId, capabilityId),
        eq(controlCapabilityAssessments.tenantId, tenantId),
        ...axes.map((axis) => eq(axis === 'strength' ? controlCapabilityAssessments.strengthMode : controlCapabilityAssessments.coverageMode, 'auto')),
      ))
      .returning(),

  deleteAssessmentSources: ({ db }, assessmentId: string, axes: ReadonlyArray<AssessmentAxis>) =>
    db.delete(controlCapabilityAssessmentSources).where(and(
      eq(controlCapabilityAssessmentSources.assessmentId, assessmentId),
      inArray(controlCapabilityAssessmentSources.axis, [...axes]),
    )),

  insertAssessmentSources: ({ db }, rows: Array<typeof controlCapabilityAssessmentSources.$inferInsert>) =>
    rows.length === 0 ? Promise.resolve() : db.insert(controlCapabilityAssessmentSources).values(rows).then(() => undefined),

  insertAssessmentEvent: ({ db }, values: typeof controlCapabilityAssessmentEvents.$inferInsert) =>
    db.insert(controlCapabilityAssessmentEvents).values([values]),

  insertAssessmentEventSources: ({ db }, rows: Array<typeof controlCapabilityAssessmentEventSources.$inferInsert>) =>
    rows.length === 0 ? Promise.resolve() : db.insert(controlCapabilityAssessmentEventSources).values(rows).then(() => undefined),

  // ─── Scope posture overlay ───────────────────────────────────────────────────

  findAssessments: ({ db, views }, tenantId: string) =>
    db
      .select({
        capabilityId: views.controlCapabilityAssessments.capabilityId,
        strengthRung: views.controlCapabilityAssessments.strengthRung,
        coverageBucket: views.controlCapabilityAssessments.coverageBucket,
        comment: views.controlCapabilityAssessments.comment,
      })
      .from(views.controlCapabilityAssessments)
      .where(eq(views.controlCapabilityAssessments.tenantId, tenantId)),

  findTenantPosture: ({ db, views }, capabilityId: string, tenantId: string) =>
    db
      .select({
        strengthRung: views.controlCapabilityAssessments.strengthRung,
        coverageBucket: views.controlCapabilityAssessments.coverageBucket,
      })
      .from(views.controlCapabilityAssessments)
      .where(and(
        eq(views.controlCapabilityAssessments.capabilityId, capabilityId),
        eq(views.controlCapabilityAssessments.tenantId, tenantId),
      ))
      .limit(1)
      .then((rows) => rows.at(0)),

  findScopeOverrides: (
    { db, views },
    { organizationId }: { organizationId: string },
  ) =>
    db
      .select({
        capabilityId: views.controlCapabilityScopeOverrides.capabilityId,
        strengthRung: views.controlCapabilityScopeOverrides.strengthRung,
        coverageBucket: views.controlCapabilityScopeOverrides.coverageBucket,
        comment: views.controlCapabilityScopeOverrides.comment,
        updatedAt: views.controlCapabilityScopeOverrides.updatedAt,
      })
      .from(views.controlCapabilityScopeOverrides)
      .where(eq(views.controlCapabilityScopeOverrides.organizationId, organizationId)),

  findScopeOverride: async (
    { db, views },
    { organizationId, capabilityId }: { organizationId: string, capabilityId: string },
  ) =>
    db
      .select({
        strengthRung: views.controlCapabilityScopeOverrides.strengthRung,
        coverageBucket: views.controlCapabilityScopeOverrides.coverageBucket,
        comment: views.controlCapabilityScopeOverrides.comment,
      })
      .from(views.controlCapabilityScopeOverrides)
      .where(and(
        eq(views.controlCapabilityScopeOverrides.organizationId, organizationId),
        eq(views.controlCapabilityScopeOverrides.capabilityId, capabilityId),
      ))
      .limit(1)
      .then((rows) => rows.at(0)),

  /** Refuses a scope the caller cannot see, so a foreign one answers Not Found rather than
   * dissolving into the zero-row no-op a policy-filtered write would leave. */
  validateOrganizationId: async ({ db, views }, organizationId: string) => {
    const rows = await db
      .select({ id: views.organizations.id })
      .from(views.organizations)
      .where(eq(views.organizations.id, organizationId))
      .limit(1);
    if (rows.length === 0) {
      throw newError('Not Found');
    }
  },

  // Upsert for the same reason the tenant declaration's write does: two concurrent first-saves on
  // the same (scope, capability) both miss the prior read and collide on the unique constraint.
  upsertScopeOverrideValues: (
    { db },
    { organizationId, capabilityId }: { organizationId: string, capabilityId: string },
    { strengthRung, coverageBucket, comment }: {
      strengthRung: StrengthRung | null,
      coverageBucket: CoverageBucket | null,
      comment: string | null,
    },
  ) =>
    db.insert(controlCapabilityScopeOverrides)
      .values({ id: uuidv7(), organizationId, capabilityId, strengthRung, coverageBucket, comment })
      .onConflictDoUpdate({
        target: [controlCapabilityScopeOverrides.organizationId, controlCapabilityScopeOverrides.capabilityId],
        set: { strengthRung, coverageBucket, comment, updatedAt: sql`now()` },
      }),

  deleteScopeOverride: (
    { db },
    { organizationId, capabilityId }: { organizationId: string, capabilityId: string },
  ) =>
    db.delete(controlCapabilityScopeOverrides).where(and(
      eq(controlCapabilityScopeOverrides.organizationId, organizationId),
      eq(controlCapabilityScopeOverrides.capabilityId, capabilityId),
    )),

  // ─── Technique coverage overrides ────────────────────────────────────────────

  validateTechniqueId: async ({ db, views }, techniqueId: string) => {
    const result = await db
      .select({ id: views.mitreTechniques.id })
      .from(views.mitreTechniques)
      .where(eq(views.mitreTechniques.id, techniqueId))
      .limit(1);
    if (result.length === 0) {
      throw newError('Not Found');
    }
  },

  isTechniqueInCatalogue: async (
    { db, views },
    capabilityId: string,
    techniqueId: string,
    fn: CapabilityFunction,
  ) =>
    db
      .select({ id: views.controlCapabilityEdges.id })
      .from(views.controlCapabilityEdges)
      .where(and(
        eq(views.controlCapabilityEdges.capabilityId, capabilityId),
        eq(views.controlCapabilityEdges.mitreTechniqueId, techniqueId),
        eq(views.controlCapabilityEdges.function, fn),
      ))
      .limit(1)
      .then((rows) => rows.length > 0),

  findTechniqueOverride: async (
    { db, views },
    { capabilityId, tenantId, techniqueId, function: fn }:
      { capabilityId: string, tenantId: string, techniqueId: string, function: CapabilityFunction },
  ) =>
    db
      .select({
        kind: views.controlCapabilityTechniqueOverrides.kind,
        function: views.controlCapabilityTechniqueOverrides.function,
      })
      .from(views.controlCapabilityTechniqueOverrides)
      .where(and(
        eq(views.controlCapabilityTechniqueOverrides.capabilityId, capabilityId),
        eq(views.controlCapabilityTechniqueOverrides.tenantId, tenantId),
        eq(views.controlCapabilityTechniqueOverrides.mitreTechniqueId, techniqueId),
        eq(views.controlCapabilityTechniqueOverrides.function, fn),
      ))
      .limit(1)
      .then((rows) => rows.at(0)),

  // Upsert for the same reason the assessment write does: two concurrent first-saves on the
  // same (tenant, capability, technique, function) would both miss the prior read and collide.
  upsertTechniqueOverride: (
    { db },
    { capabilityId, tenantId, techniqueId, function: fn }:
      { capabilityId: string, tenantId: string, techniqueId: string, function: CapabilityFunction },
    { kind }: { kind: TechniqueOverrideKind },
  ) =>
    db.insert(controlCapabilityTechniqueOverrides)
      .values({ id: uuidv7(), capabilityId, tenantId, mitreTechniqueId: techniqueId, kind, function: fn })
      .onConflictDoUpdate({
        target: [
          controlCapabilityTechniqueOverrides.tenantId,
          controlCapabilityTechniqueOverrides.capabilityId,
          controlCapabilityTechniqueOverrides.mitreTechniqueId,
          controlCapabilityTechniqueOverrides.function,
        ],
        set: { kind },
      }),

  deleteTechniqueOverride: (
    { db },
    { capabilityId, tenantId, techniqueId, function: fn }:
      { capabilityId: string, tenantId: string, techniqueId: string, function: CapabilityFunction },
  ) =>
    db.delete(controlCapabilityTechniqueOverrides).where(and(
      eq(controlCapabilityTechniqueOverrides.capabilityId, capabilityId),
      eq(controlCapabilityTechniqueOverrides.tenantId, tenantId),
      eq(controlCapabilityTechniqueOverrides.mitreTechniqueId, techniqueId),
      eq(controlCapabilityTechniqueOverrides.function, fn),
    )),

  /** Without a function, discards the control's overrides on every function. */
  deleteTechniqueOverridesForCapability: (
    { db },
    { capabilityId, tenantId, function: fn }:
      { capabilityId: string, tenantId: string, function?: CapabilityFunction },
  ) =>
    db.delete(controlCapabilityTechniqueOverrides).where(and(
      eq(controlCapabilityTechniqueOverrides.capabilityId, capabilityId),
      eq(controlCapabilityTechniqueOverrides.tenantId, tenantId),
      ...(fn ? [eq(controlCapabilityTechniqueOverrides.function, fn)] : []),
    )),

  /**
   * Per control and per level (the tenant's, and the named scope's), the first line logged at or
   * after `cutoff`: its old value is what that level held just before the cutoff.
   */
  findFirstPostureEventsAfter: ({ db, views }, tenantId: string, organizationId: string, cutoff: Date) =>
    // bounded-by: the posture changes logged since the cutoff
    db
      .selectDistinctOn([views.controlCapabilityAssessmentEvents.capabilityId, views.controlCapabilityAssessmentEvents.organizationId], {
        capabilityId: views.controlCapabilityAssessmentEvents.capabilityId,
        organizationId: views.controlCapabilityAssessmentEvents.organizationId,
        oldStrength: views.controlCapabilityAssessmentEvents.oldStrength,
        oldCoverage: views.controlCapabilityAssessmentEvents.oldCoverage,
      })
      .from(views.controlCapabilityAssessmentEvents)
      .where(and(
        eq(views.controlCapabilityAssessmentEvents.tenantId, tenantId),
        or(
          isNull(views.controlCapabilityAssessmentEvents.organizationId),
          eq(views.controlCapabilityAssessmentEvents.organizationId, organizationId),
        ),
        gte(views.controlCapabilityAssessmentEvents.createdAt, cutoff),
      ))
      .orderBy(
        views.controlCapabilityAssessmentEvents.capabilityId,
        views.controlCapabilityAssessmentEvents.organizationId,
        asc(views.controlCapabilityAssessmentEvents.createdAt),
        asc(views.controlCapabilityAssessmentEvents.id),
      ),

  /** Every line logged in `[from, to)` at either level, the tenant's or the named scope's, that moved a value. */
  findPostureEventsWithin: ({ db, views }, tenantId: string, organizationId: string, from: Date, to: Date) =>
    db
      .select({
        capabilityId: views.controlCapabilityAssessmentEvents.capabilityId,
        createdAt: views.controlCapabilityAssessmentEvents.createdAt,
      })
      .from(views.controlCapabilityAssessmentEvents)
      .where(and(
        eq(views.controlCapabilityAssessmentEvents.tenantId, tenantId),
        ne(views.controlCapabilityAssessmentEvents.type, 'sources_changed'),
        or(
          isNull(views.controlCapabilityAssessmentEvents.organizationId),
          eq(views.controlCapabilityAssessmentEvents.organizationId, organizationId),
        ),
        gte(views.controlCapabilityAssessmentEvents.createdAt, from),
        lt(views.controlCapabilityAssessmentEvents.createdAt, to),
      ))
      .orderBy(
        asc(views.controlCapabilityAssessmentEvents.createdAt),
        asc(views.controlCapabilityAssessmentEvents.id),
      ),

  /** When the posture log of a scope begins: its tenant's lines and its own, whichever came first. */
  findFirstPostureEventAt: async ({ db, views }, tenantId: string, organizationId: string): Promise<Date | null> => {
    const [row] = await db
      .select({ at: min(views.controlCapabilityAssessmentEvents.createdAt) })
      .from(views.controlCapabilityAssessmentEvents)
      .where(and(
        eq(views.controlCapabilityAssessmentEvents.tenantId, tenantId),
        or(
          isNull(views.controlCapabilityAssessmentEvents.organizationId),
          eq(views.controlCapabilityAssessmentEvents.organizationId, organizationId),
        ),
      ));
    return row?.at ?? null;
  },

  /**
   * One chronology in one statement: the tenant lines, plus the named scope's own when there is one.
   * Without a scope the tenant lines alone, so the reading outside any scope stays that declaration's
   * own history rather than every scope's put together.
   */
  findCapabilityEvents: async ({ db, views }, capabilityId: string, tenantId: string, organizationId?: string) =>
    db
      .select({
        id: views.controlCapabilityAssessmentEvents.id,
        capabilityId: views.controlCapabilityAssessmentEvents.capabilityId,
        tenantId: views.controlCapabilityAssessmentEvents.tenantId,
        organizationId: views.controlCapabilityAssessmentEvents.organizationId,
        userId: views.controlCapabilityAssessmentEvents.userId,
        connector: views.controlCapabilityAssessmentEvents.connector,
        type: views.controlCapabilityAssessmentEvents.type,
        oldStrength: views.controlCapabilityAssessmentEvents.oldStrength,
        newStrength: views.controlCapabilityAssessmentEvents.newStrength,
        oldCoverage: views.controlCapabilityAssessmentEvents.oldCoverage,
        newCoverage: views.controlCapabilityAssessmentEvents.newCoverage,
        strengthMode: views.controlCapabilityAssessmentEvents.strengthMode,
        coverageMode: views.controlCapabilityAssessmentEvents.coverageMode,
        comment: views.controlCapabilityAssessmentEvents.comment,
        createdAt: views.controlCapabilityAssessmentEvents.createdAt,
        userName: views.users.name,
      })
      .from(views.controlCapabilityAssessmentEvents)
      .leftJoin(views.users, eq(views.controlCapabilityAssessmentEvents.userId, views.users.id))
      .where(and(
        eq(views.controlCapabilityAssessmentEvents.capabilityId, capabilityId),
        eq(views.controlCapabilityAssessmentEvents.tenantId, tenantId),
        organizationId === undefined
          ? isNull(views.controlCapabilityAssessmentEvents.organizationId)
          : or(
            isNull(views.controlCapabilityAssessmentEvents.organizationId),
            eq(views.controlCapabilityAssessmentEvents.organizationId, organizationId),
          ),
      ))
      .orderBy(
        desc(views.controlCapabilityAssessmentEvents.createdAt),
        desc(views.controlCapabilityAssessmentEvents.id),
      ),

  findEventSources: ({ db, views }, tenantId: string, eventIds: ReadonlyArray<string>) =>
    db
      .select({
        eventId: views.controlCapabilityAssessmentEventSources.eventId,
        axis: views.controlCapabilityAssessmentEventSources.axis,
        source: views.controlCapabilityAssessmentEventSources.source,
        frameworkTitle: views.complianceFrameworks.title,
        complianceAssessmentId: views.controlCapabilityAssessmentEventSources.complianceAssessmentId,
        complianceAssessmentName: views.controlCapabilityAssessmentEventSources.complianceAssessmentName,
      })
      .from(views.controlCapabilityAssessmentEventSources)
      .leftJoin(views.complianceFrameworks, eq(views.complianceFrameworks.key, views.controlCapabilityAssessmentEventSources.source))
      .where(and(
        eq(views.controlCapabilityAssessmentEventSources.tenantId, tenantId),
        inArray(views.controlCapabilityAssessmentEventSources.eventId, [...eventIds]),
      ))
      .orderBy(
        asc(views.controlCapabilityAssessmentEventSources.axis),
        asc(views.controlCapabilityAssessmentEventSources.source),
        ...orderByFolded(views.controlCapabilityAssessmentEventSources.complianceAssessmentNameFolded, views.controlCapabilityAssessmentEventSources.complianceAssessmentName, false),
      ),
});
