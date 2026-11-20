import { desc, eq, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { lossAnswersVersion } from './answers-version';
import { financialProfileEvents, financialProfiles } from './schema';

// `updated_at` is what a scenario's derivation stamps itself against, so it must be written on the
// database's clock: the application's sits 240 ms from it on a dev stack, wide enough to make a
// save look older than the run that already covered it.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: a sql template literal must be cast to Date for a timestamp column
const nowFromDatabase = () => sql`now()` as unknown as Date;

export const financialProfilesRepository = defineRepository({
  findFinancialProfileByOrganizationId: async ({ db, views }, organizationId: string) => (await db
    .select()
    .from(views.financialProfiles)
    .where(eq(views.financialProfiles.organizationId, organizationId))
    .limit(1)).at(0),

  /** Every organization whose answers something can derive from. */
  findOrganizationIdsWithProfile: async ({ db, views }) => (await db
    .selectDistinct({ organizationId: views.financialProfiles.organizationId })
    .from(views.financialProfiles)).map((row) => row.organizationId),

  /**
   * The exact version of the answers a derivation is about to read, as text: a timestamp read back
   * into a `Date` loses its microseconds, and a version that travels through the application has
   * to come back able to match the row it was read from.
   */
  findAnswersVersion: async ({ db, views }, organizationId: string): Promise<string | undefined> => (await db
    .select({ answersVersion: sql<string>`${lossAnswersVersion({ views })}::text` })
    .from(views.financialProfiles)
    .where(eq(views.financialProfiles.organizationId, organizationId))
    .limit(1)).at(0)?.answersVersion,

  /**
   * Insert-or-update keyed on `organizationId`: the row is a 1:1 optional profile, so a save
   * must never delete-then-reinsert, which would lose the stable `id` and any concurrent read.
   */
  upsertFinancialProfile: async ({ db }, values: typeof financialProfiles.$inferInsert) => {
    const { id: _id, tenantId: _tenantId, organizationId: _organizationId, ...updatable } = values;
    const stamped = { ...values, updatedAt: nowFromDatabase() };
    await db.insert(financialProfiles).values([stamped]).onConflictDoUpdate({
      target: financialProfiles.organizationId,
      set: { ...updatable, updatedAt: nowFromDatabase() },
    });
  },

  /**
   * Holds the scope until the transaction ends, so two saves compare, write and journal its answers
   * one after the other. False when the scope is not visible. Holds only inside `atomic`.
   */
  lockScopeForUpdate: async ({ db, views }, organizationId: string) => (await db
    .select({ id: views.organizations.id })
    .from(views.organizations)
    .where(eq(views.organizations.id, organizationId))
    .for('no key update')).length > 0,

  findFinancialProfileEvents: async ({ db, views }, organizationId: string, limit: number) => db
    .select({
      id: views.financialProfileEvents.id,
      field: views.financialProfileEvents.field,
      oldValue: views.financialProfileEvents.oldValue,
      newValue: views.financialProfileEvents.newValue,
      createdAt: views.financialProfileEvents.createdAt,
      userName: sql<string | null>`coalesce(${views.users.name}, ${views.users.email})`,
    })
    .from(views.financialProfileEvents)
    .leftJoin(views.users, eq(views.users.id, views.financialProfileEvents.userId))
    .where(eq(views.financialProfileEvents.organizationId, organizationId))
    .orderBy(desc(views.financialProfileEvents.createdAt), desc(views.financialProfileEvents.id))
    .limit(limit),

  insertFinancialProfileEvents: async ({ db }, rows: Array<typeof financialProfileEvents.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(financialProfileEvents).values(rows);
    }
  },

  /**
   * Stamps which coefficient set the profile was last derived under. A no-op when the organization
   * has no profile row: nothing to stamp.
   */
  updateCoefficientSetVersion: ({ db }, organizationId: string, coefficientSetVersion: string) =>
    db
      .update(financialProfiles)
      .set({ coefficientSetVersion })
      .where(eq(financialProfiles.organizationId, organizationId)),
});
