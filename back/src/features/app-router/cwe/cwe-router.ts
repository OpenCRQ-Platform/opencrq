import { CWE_LINK_ENTRY_STATES, CWE_LINK_JUSTIFICATION_KINDS } from '@app/module';
import { z } from 'zod';
import type { TenantProcedure, TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { userSessionOnly } from '../user-session-only';

const CweExternalId = z.string().regex(/^CWE-\d+$/);

const CatalogueEntrySchema = z.object({
  externalId: z.string(),
  name: z.string(),
  techniqueCount: z.number().int(),
  modified: z.boolean(),
  presentInFindings: z.boolean(),
});

const TechniqueEntrySchema = z.object({
  techniqueId: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  state: z.enum(CWE_LINK_ENTRY_STATES),
  justifications: z.array(z.object({
    kind: z.enum(CWE_LINK_JUSTIFICATION_KINDS),
    ref: z.string(),
    name: z.string().nullable(),
  })),
});

const CweDetailSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  description: z.string(),
  techniques: z.array(TechniqueEntrySchema),
  overrideCount: z.number().int(),
});

const TechniqueEditInput = z.object({ cweId: CweExternalId, techniqueId: z.uuid() });

export const cweRouter = (procedure: TenantProcedure, securityProcedure: TenantSecurityProcedure) => router({
  // bounded-by: the CWE catalogue, ~950 weaknesses, one platform-wide copy
  list: procedure
    .output(z.array(CatalogueEntrySchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin).cwe.listCatalogue()),

  get: procedure
    .input(z.object({ cweId: CweExternalId }))
    .output(CweDetailSchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin).cwe.getCwe(input.cweId)),

  addTechnique: securityProcedure
    .use(userSessionOnly)
    .input(TechniqueEditInput)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin).cwe.addTechnique(input.cweId, input.techniqueId);
    }),

  removeTechnique: securityProcedure
    .use(userSessionOnly)
    .input(TechniqueEditInput)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin).cwe.removeTechnique(input.cweId, input.techniqueId);
    }),

  restoreTechnique: securityProcedure
    .use(userSessionOnly)
    .input(TechniqueEditInput)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin).cwe.restoreTechnique(input.cweId, input.techniqueId);
    }),

  reset: securityProcedure
    .use(userSessionOnly)
    .input(z.object({ cweId: CweExternalId }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin).cwe.resetCwe(input.cweId);
    }),
});
