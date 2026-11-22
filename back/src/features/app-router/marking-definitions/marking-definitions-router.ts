import { z } from 'zod';
import type { TenantProcedure, TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const MarkingDefinitionSchema = z.object({
  id: z.string(),
  stixId: z.string(),
  definitionType: z.string(),
  definition: z.string(),
  color: z.string().nullable(),
  order: z.number(),
});

const GroupMarkingSchema = MarkingDefinitionSchema.pick({ id: true, stixId: true, definitionType: true, definition: true });

/**
 * The marking definitions of a tenant and the clearance of its groups (CTEM marking parity, G2,
 * slice 3). Every member lists the markings, so a form can offer them; only a security manager
 * creates, changes or deletes one and changes what a group is cleared for.
 */
export const markingDefinitionsRouter = (procedure: TenantProcedure, securityProcedure: TenantSecurityProcedure) => router({
  // bounded-by: the tenant's markings, the TLP set and the ones a security manager adds by hand
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One and API clients manage markings and clearance by name; the settings screen comes in a later slice
  listMarkingDefinitions: procedure
    .output(z.array(MarkingDefinitionSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .markingDefinitions.listMarkingDefinitions()),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One and API clients manage markings and clearance by name; the settings screen comes in a later slice
  createMarkingDefinition: securityProcedure
    .input(z.object({
      definitionType: z.string().min(1),
      definition: z.string().min(1),
      color: z.string().nullable().optional(),
      order: z.number().int().optional(),
    }))
    .output(z.object({ id: z.string(), stixId: z.string(), created: z.boolean() }))
    .mutation(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .markingDefinitions.createMarkingDefinition(input)),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One and API clients manage markings and clearance by name; the settings screen comes in a later slice
  updateMarkingDefinition: securityProcedure
    .input(z.object({ id: z.uuid(), color: z.string().nullable().optional(), order: z.number().int().optional() }))
    .output(z.void())
    .mutation(async ({ input: { id, ...values }, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .markingDefinitions.updateMarkingDefinition(id, values);
    }),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One and API clients manage markings and clearance by name; the settings screen comes in a later slice
  deleteMarkingDefinition: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .markingDefinitions.deleteMarkingDefinition(input.id);
    }),
  // bounded-by: the tenant's markings, each once
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One and API clients manage markings and clearance by name; the settings screen comes in a later slice
  getGroupMarkings: securityProcedure
    .input(z.object({ groupId: z.uuid() }))
    .output(z.array(GroupMarkingSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .markingDefinitions.getGroupMarkings(input.groupId)),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One and API clients manage markings and clearance by name; the settings screen comes in a later slice
  addMarkingToGroup: securityProcedure
    .input(z.object({ groupId: z.uuid(), markingDefinitionId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .markingDefinitions.addMarkingToGroup(input.groupId, input.markingDefinitionId);
    }),
  // eslint-disable-next-line app/no-unused-router-endpoint -- XTM One and API clients manage markings and clearance by name; the settings screen comes in a later slice
  removeMarkingFromGroup: securityProcedure
    .input(z.object({ groupId: z.uuid(), markingDefinitionId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .markingDefinitions.removeMarkingFromGroup(input.groupId, input.markingDefinitionId);
    }),
});
