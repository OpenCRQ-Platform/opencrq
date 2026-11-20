import { and, eq, ne, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { defaultThreatsSettings } from './schema';

export interface DefaultThreatsLoadRecord {
  etag: string | null,
  lastModified: string | null,
  appVersion: string | null,
  attackRelease: string | null,
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
const dbNow = (): Date => sql`now()` as unknown as Date;

const CLEARED_LOAD_RECORD = { etag: null, lastModified: null, appVersion: null, attackRelease: null, loadedAt: null };

export const defaultThreatsRepository = defineRepository({
  findSettings: async ({ db, views }, tenantId: string) =>
    (await db.select().from(views.defaultThreatsSettings)
      .where(eq(views.defaultThreatsSettings.tenantId, tenantId))
      .limit(1)).at(0) ?? null,

  /** Switching off clears the load record too: enabling again loads the file whatever it says. */
  saveEnabled: async ({ db }, tenantId: string, enabled: boolean, id: string) =>
    db.insert(defaultThreatsSettings)
      .values([{ id, tenantId, enabled, ...CLEARED_LOAD_RECORD }])
      .onConflictDoUpdate({
        target: defaultThreatsSettings.tenantId,
        set: { enabled, ...(enabled ? {} : CLEARED_LOAD_RECORD), updatedAt: dbNow() },
      }),

  /** A tenant switched off keeps no record, so that switching back on loads the file. */
  saveLoadRecord: async ({ db }, tenantId: string, record: DefaultThreatsLoadRecord, id: string) =>
    db.insert(defaultThreatsSettings)
      .values([{ id, tenantId, ...record, loadedAt: dbNow() }])
      .onConflictDoUpdate({
        target: defaultThreatsSettings.tenantId,
        set: { ...record, loadedAt: dbNow(), updatedAt: dbNow() },
        setWhere: eq(defaultThreatsSettings.enabled, true),
      }),

  clearLoadRecord: async ({ db }, tenantId: string) =>
    db.update(defaultThreatsSettings)
      .set({ ...CLEARED_LOAD_RECORD, updatedAt: dbNow() })
      .where(eq(defaultThreatsSettings.tenantId, tenantId)),

  findHeldStixIds: async ({ db, views }, tenantId: string) =>
    (await db.select({ stixId: views.threatAnalyses.stixId })
      .from(views.threatAnalyses)
      .where(and(eq(views.threatAnalyses.tenantId, tenantId), eq(views.threatAnalyses.kind, 'default-threats'))))
      .map((row) => row.stixId),

  countThreatsBySource: async ({ db, views }, tenantId: string) => {
    const [row] = await db.select({
      own: sql<number>`count(*) filter (where ${views.threatAnalyses.kind} = 'default-threats')`.mapWith(Number),
      others: sql<number>`count(*) filter (where ${ne(views.threatAnalyses.kind, 'default-threats')})`.mapWith(Number),
      groups: sql<number>`count(*) filter (where ${views.threatAnalyses.kind} = 'default-threats' and ${views.threatAnalyses.entityType} = 'intrusion-set')`.mapWith(Number),
      campaigns: sql<number>`count(*) filter (where ${views.threatAnalyses.kind} = 'default-threats' and ${views.threatAnalyses.entityType} = 'campaign')`.mapWith(Number),
    })
      .from(views.threatAnalyses)
      .where(eq(views.threatAnalyses.tenantId, tenantId));
    return row ?? { own: 0, others: 0, groups: 0, campaigns: 0 };
  },
});
