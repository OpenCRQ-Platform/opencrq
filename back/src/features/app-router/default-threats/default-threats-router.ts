import { CONNECTOR_INVENTORY, MITRE_ATTACK_CATALOGUE_RELEASE, originTrigger } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { defaultThreatsFileUrl } from '../connectors/connector-configuration';

const OverviewSchema = z.object({
  enabled: z.boolean(),
  /** Null when the platform turned the connector off. */
  datasetFileUrl: z.string().nullable(),
  /** The ATT&CK release of the file last loaded, null before a load. */
  datasetRelease: z.string().nullable(),
  catalogueRelease: z.string(),
  loadedAt: z.string().nullable(),
  groups: z.number().int(),
  campaigns: z.number().int(),
  /** The tenant's threats from every other source, which switching the connector off leaves. */
  otherThreats: z.number().int(),
});

export const defaultThreatsRouter = (procedure: TenantProcedure) => router({
  getOverview: procedure
    .output(OverviewSchema)
    .query(async ({ ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      const [settings, counts] = await Promise.all([
        scoped.defaultThreats.getSettings(tenantId),
        scoped.defaultThreats.countThreats(),
      ]);
      return {
        enabled: settings.enabled,
        datasetFileUrl: defaultThreatsFileUrl(config().connectors),
        datasetRelease: settings.attackRelease,
        catalogueRelease: MITRE_ATTACK_CATALOGUE_RELEASE,
        loadedAt: settings.loadedAt?.toISOString() ?? null,
        groups: counts.groups,
        campaigns: counts.campaigns,
        otherThreats: counts.others,
      };
    }),

  /** Switching on loads the dataset at once; switching off removes the connector's threats. */
  setEnabled: procedure
    .input(z.object({ enabled: z.boolean() }))
    .output(z.object({ retracted: z.number().int() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      // The permission that configures every other connector.
      if (!await scoped.capabilities.hasManageSecurity()) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const { retracted } = await scoped.defaultThreats.setEnabled(input.enabled);
      const entry = CONNECTOR_INVENTORY.default_threats;
      if (input.enabled && defaultThreatsFileUrl(config().connectors) !== null) {
        await scoped.jobs.enqueueJob({
          kind: entry.jobKind,
          tenantId,
          payload: {},
          ...originTrigger(origin),
          interactive: true,
          maxRuntimeMs: entry.maxRuntimeMs,
          maxAttempts: entry.maxAttempts,
          skipIfActive: true,
        });
      }
      return { retracted };
    }),
});
