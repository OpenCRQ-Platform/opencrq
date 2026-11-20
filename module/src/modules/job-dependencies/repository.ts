import { and, eq } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { jobDependencies } from './schema';

export const jobDependenciesRepository = defineRepository({
  findAllDependencies: async ({ db, views }) =>
    db.select({
      jobKind: views.jobDependencies.jobKind,
      tenantId: views.jobDependencies.tenantId,
      tableName: views.jobDependencies.tableName,
      access: views.jobDependencies.access,
    }).from(views.jobDependencies),

  findDependencies: async ({ db, views }, jobKind: string, tenantId: string) =>
    db.select({ tableName: views.jobDependencies.tableName, access: views.jobDependencies.access })
      .from(views.jobDependencies)
      .where(and(eq(views.jobDependencies.jobKind, jobKind), eq(views.jobDependencies.tenantId, tenantId))),

  deleteDependencies: ({ db }, jobKind: string, tenantId: string) =>
    db.delete(jobDependencies).where(and(eq(jobDependencies.jobKind, jobKind), eq(jobDependencies.tenantId, tenantId))),

  insertDependencies: ({ db }, values: Array<typeof jobDependencies.$inferInsert>) =>
    db.insert(jobDependencies).values(values),
});
