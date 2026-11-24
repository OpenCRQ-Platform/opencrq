import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { newError } from '@app/utils';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { SecuredSchema } from '../../security';
import { orderByFolded } from '../../db/fold-text';
import { defineRepository } from '../../registry';
import { requirementLossDriverActivations, requirements, requirementTargets } from './schema';

export type RequirementUpdate = Partial<Pick<typeof requirements.$inferInsert,
  'name' | 'description' | 'interestedParty' | 'protectsConfidentiality' | 'protectsIntegrity' | 'protectsAvailability'>>;

const requirementSelection = (views: SecuredSchema) => ({
  id: views.requirements.id,
  organizationId: views.requirements.organizationId,
  name: views.requirements.name,
  description: views.requirements.description,
  interestedParty: views.requirements.interestedParty,
  protectsConfidentiality: views.requirements.protectsConfidentiality,
  protectsIntegrity: views.requirements.protectsIntegrity,
  protectsAvailability: views.requirements.protectsAvailability,
  createdAt: views.requirements.createdAt,
  updatedAt: views.requirements.updatedAt,
});

/** Anything but `none` counts as reached. */
const reaches = (column: PgColumn) => ne(column, 'none');

export const requirementsRepository = defineRepository({
  insertRequirement: ({ db }, values: typeof requirements.$inferInsert) =>
    db.insert(requirements).values([values]),

  updateRequirement: ({ db }, id: string, values: RequirementUpdate) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    return db.update(requirements).set({ ...values, updatedAt }).where(eq(requirements.id, id));
  },

  deleteRequirements: ({ db }, ids: Array<string>) =>
    db.delete(requirements).where(inArray(requirements.id, ids)),

  findRequirements: ({ db, views }, organizationId: string) =>
    db.select(requirementSelection(views))
      .from(views.requirements)
      .where(eq(views.requirements.organizationId, organizationId))
      .orderBy(...orderByFolded(views.requirements.nameFolded, views.requirements.name, false)),

  findRequirementById: ({ db, views }, id: string) =>
    db.select(requirementSelection(views))
      .from(views.requirements)
      .where(eq(views.requirements.id, id))
      .limit(1)
      .then((rows) => rows.at(0)),

  /** Each target named, a primary asset or a business resource category: one of the two groups is null. */
  findTargets: ({ db, views }, requirementIds: Array<string>) =>
    db.select({
      id: views.requirementTargets.id,
      requirementId: views.requirementTargets.requirementId,
      primaryAsset: { id: views.primaryAssets.id, name: views.primaryAssets.name },
      businessValueCategory: {
        id: views.businessValueCategories.id,
        code: views.businessValueCategories.code,
        name: views.businessValueCategories.name,
      },
    })
      .from(views.requirementTargets)
      .leftJoin(views.primaryAssets, eq(views.primaryAssets.id, views.requirementTargets.primaryAssetId))
      .leftJoin(views.businessValueCategories, eq(views.businessValueCategories.id, views.requirementTargets.businessValueCategoryId))
      .where(inArray(views.requirementTargets.requirementId, requirementIds))
      .orderBy(asc(views.businessValueCategories.displayOrder), asc(views.primaryAssets.name)),

  findLossDrivers: ({ db, views }, requirementIds: Array<string>) =>
    db.select({
      requirementId: views.requirementLossDriverActivations.requirementId,
      id: views.lossDrivers.id,
      name: views.lossDrivers.name,
    })
      .from(views.requirementLossDriverActivations)
      .innerJoin(views.lossDrivers, eq(views.lossDrivers.id, views.requirementLossDriverActivations.lossDriverId))
      .innerJoin(views.lossCategories, eq(views.lossCategories.id, views.lossDrivers.lossCategoryId))
      .where(inArray(views.requirementLossDriverActivations.requirementId, requirementIds))
      .orderBy(asc(views.lossCategories.displayOrder), asc(views.lossDrivers.displayOrder)),

  insertTargets: ({ db }, values: Array<typeof requirementTargets.$inferInsert>) =>
    db.insert(requirementTargets).values(values),

  deleteTargets: ({ db }, ids: Array<string>) =>
    db.delete(requirementTargets).where(inArray(requirementTargets.id, ids)),

  insertLossDriverActivations: ({ db }, values: Array<typeof requirementLossDriverActivations.$inferInsert>) =>
    db.insert(requirementLossDriverActivations).values(values),

  deleteLossDriverActivations: ({ db }, requirementId: string, lossDriverIds: Array<string>) =>
    db.delete(requirementLossDriverActivations).where(and(
      eq(requirementLossDriverActivations.requirementId, requirementId),
      inArray(requirementLossDriverActivations.lossDriverId, lossDriverIds),
    )),

  validateOrganization: async ({ db, views }, organizationId: string) => {
    const found = await db.select({ id: views.organizations.id })
      .from(views.organizations)
      .where(eq(views.organizations.id, organizationId))
      .limit(1);
    if (found.length === 0) {
      throw newError('Access Denied');
    }
  },

  /** A requirement only targets the primary assets of its own risk scope. */
  validatePrimaryAssetIds: async ({ db, views }, organizationId: string, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    const found = await db.select({ id: views.primaryAssets.id })
      .from(views.primaryAssets)
      .where(and(inArray(views.primaryAssets.id, ids), eq(views.primaryAssets.organizationId, organizationId)));
    if (found.length !== new Set(ids).size) {
      throw newError('Access Denied');
    }
  },

  validateBusinessValueCategoryIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    const found = await db.select({ id: views.businessValueCategories.id })
      .from(views.businessValueCategories)
      .where(inArray(views.businessValueCategories.id, ids));
    if (found.length !== new Set(ids).size) {
      throw newError('Access Denied');
    }
  },

  validateLossDriverIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    const found = await db.select({ id: views.lossDrivers.id })
      .from(views.lossDrivers)
      .where(inArray(views.lossDrivers.id, ids));
    if (found.length !== new Set(ids).size) {
      throw newError('Access Denied');
    }
  },

  /**
   * The requirements of the scenario's own risk scope it breaks: one of its targets is a primary
   * asset the requirement targets, directly or through a category the asset carries, and its attack
   * outcome reaches a criterion the requirement protects.
   */
  findBrokenRequirementsForScenario: ({ db, views }, riskScenarioId: string) => {
    const brokenIds = db.select({ id: views.requirements.id })
      .from(views.riskScenarios)
      .innerJoin(views.attackOutcomes, eq(views.attackOutcomes.id, views.riskScenarios.attackOutcomeId))
      .innerJoin(views.riskScenarioPrimaryAssets, eq(views.riskScenarioPrimaryAssets.riskScenarioId, views.riskScenarios.id))
      .leftJoin(
        views.primaryAssetBusinessValueCategories,
        eq(views.primaryAssetBusinessValueCategories.primaryAssetId, views.riskScenarioPrimaryAssets.primaryAssetId),
      )
      .innerJoin(views.requirementTargets, or(
        eq(views.requirementTargets.primaryAssetId, views.riskScenarioPrimaryAssets.primaryAssetId),
        eq(views.requirementTargets.businessValueCategoryId, views.primaryAssetBusinessValueCategories.businessValueCategoryId),
      ))
      .innerJoin(views.requirements, and(
        eq(views.requirements.id, views.requirementTargets.requirementId),
        eq(views.requirements.organizationId, views.riskScenarios.organizationId),
      ))
      .where(and(
        eq(views.riskScenarios.id, riskScenarioId),
        or(
          and(eq(views.requirements.protectsConfidentiality, true), reaches(views.attackOutcomes.reachesConfidentiality)),
          and(eq(views.requirements.protectsIntegrity, true), reaches(views.attackOutcomes.reachesIntegrity)),
          and(eq(views.requirements.protectsAvailability, true), reaches(views.attackOutcomes.reachesAvailability)),
        ),
      ));
    return db.select({ id: views.requirements.id, name: views.requirements.name, interestedParty: views.requirements.interestedParty })
      .from(views.requirements)
      .where(inArray(views.requirements.id, brokenIds))
      .orderBy(...orderByFolded(views.requirements.nameFolded, views.requirements.name, false));
  },
});
