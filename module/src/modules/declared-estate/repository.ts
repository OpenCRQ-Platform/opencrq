import { and, desc, eq, sql } from 'drizzle-orm';
import type { DeclaredEstateKind } from './constants';
import { defineRepository } from '../../registry';
import { declaredEstate, declaredEstateEvents } from './schema';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: a sql template literal must be cast to Date for a timestamp column
const nowFromDatabase = () => sql`now()` as unknown as Date;

export const declaredEstateRepository = defineRepository({
  findDeclaredEstate: async ({ db, views }, organizationId: string) => db
    .select({
      kind: views.declaredEstate.kind,
      low: views.declaredEstate.low,
      high: views.declaredEstate.high,
      internetFacing: views.declaredEstate.internetFacing,
      setAt: views.declaredEstate.setAt,
      setByUserId: views.declaredEstate.setByUserId,
      setByName: sql<string | null>`coalesce(${views.users.name}, ${views.users.email})`,
    })
    .from(views.declaredEstate)
    .leftJoin(views.users, eq(views.users.id, views.declaredEstate.setByUserId))
    .where(eq(views.declaredEstate.organizationId, organizationId)),

  /**
   * Holds the scope until the transaction ends, so two saves compare, write and journal its answers
   * one after the other. False when the scope is not visible. Holds only inside `atomic`.
   */
  lockScopeForUpdate: async ({ db, views }, organizationId: string) => (await db
    .select({ id: views.organizations.id })
    .from(views.organizations)
    .where(eq(views.organizations.id, organizationId))
    .for('no key update')).length > 0,

  /** The answers alone, with no join on `users`: an observed job reading this would wake on every account edit of the platform. */
  findDeclaredEstateAnswers: async ({ db, views }, organizationId: string) => db
    .select({
      kind: views.declaredEstate.kind,
      low: views.declaredEstate.low,
      high: views.declaredEstate.high,
      internetFacing: views.declaredEstate.internetFacing,
    })
    .from(views.declaredEstate)
    .where(eq(views.declaredEstate.organizationId, organizationId)),

  findDeclaredEstateEvents: async ({ db, views }, organizationId: string, limit: number) => db
    .select({
      id: views.declaredEstateEvents.id,
      kind: views.declaredEstateEvents.kind,
      oldLow: views.declaredEstateEvents.oldLow,
      oldHigh: views.declaredEstateEvents.oldHigh,
      oldInternetFacing: views.declaredEstateEvents.oldInternetFacing,
      newLow: views.declaredEstateEvents.newLow,
      newHigh: views.declaredEstateEvents.newHigh,
      newInternetFacing: views.declaredEstateEvents.newInternetFacing,
      createdAt: views.declaredEstateEvents.createdAt,
      userId: views.declaredEstateEvents.userId,
      userName: sql<string | null>`coalesce(${views.users.name}, ${views.users.email})`,
    })
    .from(views.declaredEstateEvents)
    .leftJoin(views.users, eq(views.users.id, views.declaredEstateEvents.userId))
    .where(eq(views.declaredEstateEvents.organizationId, organizationId))
    .orderBy(desc(views.declaredEstateEvents.createdAt), desc(views.declaredEstateEvents.id))
    .limit(limit),

  findLastDeclaredEstateChangeAt: async ({ db, views }, organizationId: string) => (await db
    .select({ createdAt: views.declaredEstateEvents.createdAt })
    .from(views.declaredEstateEvents)
    .where(eq(views.declaredEstateEvents.organizationId, organizationId))
    .orderBy(desc(views.declaredEstateEvents.createdAt), desc(views.declaredEstateEvents.id))
    .limit(1))[0]?.createdAt ?? null,

  upsertDeclaredEstateAnswer: async ({ db }, values: Omit<typeof declaredEstate.$inferInsert, 'setAt'>) => {
    const { tenantId: _tenantId, organizationId: _organizationId, kind: _kind, ...updatable } = values;
    await db.insert(declaredEstate).values([{ ...values, setAt: nowFromDatabase() }]).onConflictDoUpdate({
      target: [declaredEstate.organizationId, declaredEstate.kind],
      set: { ...updatable, setAt: nowFromDatabase() },
    });
  },

  deleteDeclaredEstateAnswer: ({ db }, organizationId: string, kind: DeclaredEstateKind) => db
    .delete(declaredEstate)
    .where(and(eq(declaredEstate.organizationId, organizationId), eq(declaredEstate.kind, kind))),

  insertDeclaredEstateEvents: async ({ db }, rows: Array<typeof declaredEstateEvents.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(declaredEstateEvents).values(rows);
    }
  },
});
