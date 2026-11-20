import type { RiskTolerance } from './constants';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { CountryNotFoundError, MappedAssetNotVisibleError, SectorNotFoundError } from './errors';
import {
  organizationAssetMappingEventAssets,
  organizationAssetMappingEvents,
  organizationAssets,
  organizationIdentityEvents,
  organizationRiskTolerances,
  organizations,
  organizationUnpins,
} from './schema';

export const organizationsRepository = defineRepository({
  insertOrganizations: ({ db }, values: Array<typeof organizations.$inferInsert>) => db.insert(organizations).values(values),
  deleteOrganizations: ({ db }, ids: Array<string>) => db.delete(organizations).where(inArray(organizations.id, ids)),
  updateOrganization: ({ db }, id: string, values: Partial<typeof organizations.$inferInsert>) => db.update(organizations).set(values).where(eq(organizations.id, id)),
  validateFirmographyIds: async ({ db, views }, ids: { sectorIds: Array<string>, countryIds: Array<string> }) => {
    if (ids.sectorIds.length > 0) {
      const found = await db.select({ id: views.sectors.id }).from(views.sectors).where(inArray(views.sectors.id, ids.sectorIds));
      if (found.length !== ids.sectorIds.length) {
        throw new SectorNotFoundError();
      }
    }
    if (ids.countryIds.length > 0) {
      const found = await db.select({ id: views.countries.id }).from(views.countries).where(inArray(views.countries.id, ids.countryIds));
      if (found.length !== ids.countryIds.length) {
        throw new CountryNotFoundError();
      }
    }
  },
  findOrganizationById: async ({ db, views }, id: string) => {
    const result = await db
      .select({
        id: views.organizations.id,
        tenantId: views.organizations.tenantId,
        name: views.organizations.name,
        description: views.organizations.description,
        legalEntityName: views.organizations.legalEntityName,
        sectorId: views.organizations.sectorId,
        countryId: views.organizations.countryId,
        revenueBand: views.organizations.revenueBand,
        employeeCount: views.organizations.employeeCount,
        domain: views.organizations.domain,
        reactionTimeMin: views.organizations.reactionTimeMin,
        reactionTimeLikely: views.organizations.reactionTimeLikely,
        reactionTimeMax: views.organizations.reactionTimeMax,
        estateMode: views.organizations.estateMode,
        estateChangedAt: views.organizations.estateChangedAt,
        sector: {
          id: views.sectors.id,
          tenantId: views.sectors.tenantId,
          name: views.sectors.name,
          description: views.sectors.description,
        },
        country: {
          id: views.countries.id,
          tenantId: views.countries.tenantId,
          name: views.countries.name,
          isoAlpha2: views.countries.isoAlpha2,
          isoAlpha3: views.countries.isoAlpha3,
        },
      })
      .from(views.organizations)
      .leftJoin(views.sectors, eq(views.organizations.sectorId, views.sectors.id))
      .leftJoin(views.countries, eq(views.organizations.countryId, views.countries.id))
      .where(eq(views.organizations.id, id))
      .limit(1);
    const row = result.at(0);
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      legalEntityName: row.legalEntityName,
      sectorId: row.sectorId,
      countryId: row.countryId,
      revenueBand: row.revenueBand,
      employeeCount: row.employeeCount,
      domain: row.domain,
      reactionTimeMin: row.reactionTimeMin,
      reactionTimeLikely: row.reactionTimeLikely,
      reactionTimeMax: row.reactionTimeMax,
      estateMode: row.estateMode,
      estateChangedAt: row.estateChangedAt,
      sector: row.sector?.id != null ? row.sector : null,
      country: row.country?.id != null ? row.country : null,
    };
  },

  /**
   * The identity a save compares against and the estate mode it may switch, the row held until the
   * transaction ends so two saves journal one after the other. Holds only inside `atomic`.
   */
  lockOrganizationForUpdate: async ({ db, views }, id: string) => (await db
    .select({
      name: views.organizations.name,
      description: views.organizations.description,
      legalEntityName: views.organizations.legalEntityName,
      domain: views.organizations.domain,
      sectorId: views.organizations.sectorId,
      countryId: views.organizations.countryId,
      employeeCount: views.organizations.employeeCount,
      reactionTimeMin: views.organizations.reactionTimeMin,
      reactionTimeLikely: views.organizations.reactionTimeLikely,
      reactionTimeMax: views.organizations.reactionTimeMax,
      estateMode: views.organizations.estateMode,
    })
    .from(views.organizations)
    .where(eq(views.organizations.id, id))
    .for('no key update')).at(0),

  /** The estate declaration alone: what every reader of a scope's estate resolves before its own query. */
  findOrganizationEstateById: async ({ db, views }, id: string) => (await db
    .select({
      id: views.organizations.id,
      estateMode: views.organizations.estateMode,
      estateChangedAt: views.organizations.estateChangedAt,
    })
    .from(views.organizations)
    .where(eq(views.organizations.id, id))
    .limit(1)).at(0),
  /**
   * The scalar organization columns alone, with no `sectors`/`countries` join: what the loss-
   * estimate derivation kernel actually reads, plus the raw firmography ids (`tenantId`, `sectorId`,
   * `countryId`) a firmography-change comparison needs. An observed job's reads become its own
   * subscription, so joining in decoration this derivation never consumes would fan a tenant-wide
   * recompute out to every edit of a sector or country label.
   */
  findOrganizationCoreById: async ({ db, views }, id: string) => (await db
    .select({
      id: views.organizations.id,
      tenantId: views.organizations.tenantId,
      sectorId: views.organizations.sectorId,
      countryId: views.organizations.countryId,
      revenueBand: views.organizations.revenueBand,
      employeeCount: views.organizations.employeeCount,
    })
    .from(views.organizations)
    .where(eq(views.organizations.id, id))
    .limit(1)).at(0),

  /** The columns a TEF catalogue read places a scope by, without the joins the full list makes. */
  findOrganizationProfiles: async ({ db, views }) => await db
    .select({
      id: views.organizations.id,
      countryId: views.organizations.countryId,
      sectorId: views.organizations.sectorId,
      employeeCount: views.organizations.employeeCount,
      revenueBand: views.organizations.revenueBand,
    })
    .from(views.organizations),

  findAllOrganizations: async ({ db, views }) => {
    const result = await db
      .select({
        id: views.organizations.id,
        tenantId: views.organizations.tenantId,
        name: views.organizations.name,
        description: views.organizations.description,
        legalEntityName: views.organizations.legalEntityName,
        sectorId: views.organizations.sectorId,
        countryId: views.organizations.countryId,
        revenueBand: views.organizations.revenueBand,
        employeeCount: views.organizations.employeeCount,
        domain: views.organizations.domain,
        reactionTimeMin: views.organizations.reactionTimeMin,
        reactionTimeLikely: views.organizations.reactionTimeLikely,
        reactionTimeMax: views.organizations.reactionTimeMax,
        estateMode: views.organizations.estateMode,
        estateChangedAt: views.organizations.estateChangedAt,
        sector: {
          id: views.sectors.id,
          tenantId: views.sectors.tenantId,
          name: views.sectors.name,
          description: views.sectors.description,
        },
        country: {
          id: views.countries.id,
          tenantId: views.countries.tenantId,
          name: views.countries.name,
          isoAlpha2: views.countries.isoAlpha2,
          isoAlpha3: views.countries.isoAlpha3,
        },
      })
      .from(views.organizations)
      .leftJoin(views.sectors, eq(views.organizations.sectorId, views.sectors.id))
      .leftJoin(views.countries, eq(views.organizations.countryId, views.countries.id));
    return result.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      legalEntityName: row.legalEntityName,
      sectorId: row.sectorId,
      countryId: row.countryId,
      revenueBand: row.revenueBand,
      employeeCount: row.employeeCount,
      domain: row.domain,
      reactionTimeMin: row.reactionTimeMin,
      reactionTimeLikely: row.reactionTimeLikely,
      reactionTimeMax: row.reactionTimeMax,
      estateMode: row.estateMode,
      estateChangedAt: row.estateChangedAt,
      sector: row.sector?.id != null ? row.sector : null,
      country: row.country?.id != null ? row.country : null,
    }));
  },

  /**
   * The junction's policy proves the scope end alone, so the asset end is proved here, at the
   * write door: an id naming nothing the caller can see refuses the whole batch.
   *
   * Two savers may hold the same tick, and a row the other one already wrote is the outcome both
   * asked for, so a conflict is not an error. The count is what this write actually added, which
   * is how a re-tick of an already mapped asset is told apart from a real estate change.
   */
  insertOrganizationAssets: async ({ db, views }, values: Array<typeof organizationAssets.$inferInsert>): Promise<Array<string>> => {
    if (values.length === 0) {
      return [];
    }
    const supportingAssetIds = [...new Set(values.map((row) => row.supportingAssetId))];
    const visible = (await db
      .select({ value: count() })
      .from(views.supportingAssets)
      .where(inArray(views.supportingAssets.id, supportingAssetIds))).at(0)?.value ?? 0;
    if (visible !== supportingAssetIds.length) {
      throw new MappedAssetNotVisibleError();
    }
    return (await db.insert(organizationAssets).values(values).onConflictDoNothing().returning()).map((row) => row.supportingAssetId);
  },
  deleteOrganizationAssets: async ({ db }, organizationId: string, supportingAssetIds: Array<string>) =>
    (await db.delete(organizationAssets).where(and(
      eq(organizationAssets.organizationId, organizationId),
      inArray(organizationAssets.supportingAssetId, supportingAssetIds),
    )).returning()).map((row) => row.supportingAssetId),
  findOrganizationIdsMappingAssets: async ({ db, views }, supportingAssetIds: Array<string>) => (await db
    .selectDistinct({ organizationId: views.organizationAssets.organizationId })
    .from(views.organizationAssets)
    .where(inArray(views.organizationAssets.supportingAssetId, supportingAssetIds)))
    .map((row) => row.organizationId),
  stampEstateChanged: ({ db }, ids: Array<string>, changedAt: Date) =>
    db.update(organizations).set({ estateChangedAt: changedAt }).where(inArray(organizations.id, ids)),
  countMappedAssets: async ({ db, views }, organizationId: string) => (await db
    .select({ value: count() })
    .from(views.organizationAssets)
    .where(eq(views.organizationAssets.organizationId, organizationId))).at(0)?.value ?? 0,
  /** Whether the scope maps anything, which is all a skip decision needs: the count walks the whole mapping to answer the same question. */
  existsMappedAsset: async ({ db, views }, organizationId: string) => (await db
    .select({ value: sql<number>`1` })
    .from(views.organizationAssets)
    .where(eq(views.organizationAssets.organizationId, organizationId))
    .limit(1)).length > 0,
  existsDeclaredEstate: async ({ db, views }, organizationId: string) => (await db
    .select({ value: sql<number>`1` })
    .from(views.declaredEstate)
    .where(eq(views.declaredEstate.organizationId, organizationId))
    .limit(1)).length > 0,
  findOrganizationIdsDeclaringEstate: async ({ db, views }) => (await db
    .selectDistinct({ organizationId: views.declaredEstate.organizationId })
    .from(views.declaredEstate))
    .map((row) => row.organizationId),
  countMappedAssetsByOrganization: ({ db, views }) => db
    .select({ organizationId: views.organizationAssets.organizationId, mappedAssetCount: count() })
    .from(views.organizationAssets)
    .groupBy(views.organizationAssets.organizationId),
  findUnpinnedOrganizationIds: async ({ db, views }) => (await db
    .select({ organizationId: views.organizationUnpins.organizationId })
    .from(views.organizationUnpins))
    .map((row) => row.organizationId),
  insertOrganizationUnpin: ({ db }, values: typeof organizationUnpins.$inferInsert) =>
    db.insert(organizationUnpins).values([values]).onConflictDoNothing(),
  findRiskTolerance: async ({ db, views }, organizationId: string): Promise<RiskTolerance | undefined> => (await db
    .select({
      annualLoss: views.organizationRiskTolerances.annualLoss,
      maxExceedanceProbability: views.organizationRiskTolerances.maxExceedanceProbability,
    })
    .from(views.organizationRiskTolerances)
    .where(eq(views.organizationRiskTolerances.organizationId, organizationId))
    .limit(1)).at(0),
  countScenarioThresholds: async ({ db, views }, organizationId: string) => (await db
    .select({
      scenarioCount: count(views.riskScenarios.id),
      ownThresholdCount: count(views.riskScenarioRiskTolerances.riskScenarioId),
    })
    .from(views.riskScenarios)
    .leftJoin(views.riskScenarioRiskTolerances, eq(views.riskScenarioRiskTolerances.riskScenarioId, views.riskScenarios.id))
    .where(eq(views.riskScenarios.organizationId, organizationId)))[0],
  upsertRiskTolerance: ({ db }, organizationId: string, tolerance: RiskTolerance) => db
    .insert(organizationRiskTolerances)
    .values([{ id: organizationId, organizationId, ...tolerance }])
    .onConflictDoUpdate({ target: organizationRiskTolerances.organizationId, set: tolerance }),
  insertIdentityEvents: async ({ db }, rows: Array<typeof organizationIdentityEvents.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(organizationIdentityEvents).values(rows);
    }
  },
  findIdentityEvents: async ({ db, views }, organizationId: string, limit: number) => db
    .select({
      id: views.organizationIdentityEvents.id,
      field: views.organizationIdentityEvents.field,
      oldValue: views.organizationIdentityEvents.oldValue,
      newValue: views.organizationIdentityEvents.newValue,
      createdAt: views.organizationIdentityEvents.createdAt,
      userName: sql<string | null>`coalesce(${views.users.name}, ${views.users.email})`,
    })
    .from(views.organizationIdentityEvents)
    .leftJoin(views.users, eq(views.users.id, views.organizationIdentityEvents.userId))
    .where(eq(views.organizationIdentityEvents.organizationId, organizationId))
    .orderBy(desc(views.organizationIdentityEvents.createdAt), desc(views.organizationIdentityEvents.id))
    .limit(limit),
  insertAssetMappingEvent: async ({ db }, values: typeof organizationAssetMappingEvents.$inferInsert) => {
    await db.insert(organizationAssetMappingEvents).values([values]);
  },
  insertAssetMappingEventAssets: async ({ db }, rows: Array<typeof organizationAssetMappingEventAssets.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(organizationAssetMappingEventAssets).values(rows);
    }
  },
  findAssetMappingEvents: async ({ db, views }, organizationId: string, limit: number) => db
    .select({
      id: views.organizationAssetMappingEvents.id,
      addedCount: views.organizationAssetMappingEvents.addedCount,
      removedCount: views.organizationAssetMappingEvents.removedCount,
      oldEstateMode: views.organizationAssetMappingEvents.oldEstateMode,
      newEstateMode: views.organizationAssetMappingEvents.newEstateMode,
      createdAt: views.organizationAssetMappingEvents.createdAt,
      userName: sql<string | null>`coalesce(${views.users.name}, ${views.users.email})`,
    })
    .from(views.organizationAssetMappingEvents)
    .leftJoin(views.users, eq(views.users.id, views.organizationAssetMappingEvents.userId))
    .where(eq(views.organizationAssetMappingEvents.organizationId, organizationId))
    .orderBy(desc(views.organizationAssetMappingEvents.createdAt), desc(views.organizationAssetMappingEvents.id))
    .limit(limit),
  /** An asset deleted since the save is gone from its rows, which the event's counts still include. */
  findAssetMappingEventAssets: async ({ db, views }, eventId: string) => db
    .select({
      change: views.organizationAssetMappingEventAssets.change,
      id: views.supportingAssets.id,
      name: views.supportingAssets.name,
      derivedName: views.supportingAssets.derivedName,
      categoryId: views.supportingAssets.categoryId,
    })
    .from(views.organizationAssetMappingEventAssets)
    .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, views.organizationAssetMappingEventAssets.supportingAssetId))
    .where(eq(views.organizationAssetMappingEventAssets.eventId, eventId))
    .orderBy(asc(views.organizationAssetMappingEventAssets.change), asc(views.supportingAssets.id)),
  deleteOrganizationUnpin: ({ db }, userId: string, organizationId: string) =>
    db.delete(organizationUnpins).where(and(
      eq(organizationUnpins.userId, userId),
      eq(organizationUnpins.organizationId, organizationId),
    )),
});
