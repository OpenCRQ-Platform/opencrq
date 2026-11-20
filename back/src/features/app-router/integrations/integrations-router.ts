import { INTEGRATION_SOURCES, integrationSettings } from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { isOriginAuthorizedForItsTenant } from '../tenant-access-utils';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { defaultThreatsRunState, resolveConnectorConfigurations } from '../connectors/connector-configuration';

const SourceSchema = z.enum(INTEGRATION_SOURCES);
const IntegrationSettingsSchema = createSelectSchema(integrationSettings, {
  source: SourceSchema,
});

// OpenCTI doesn't use the shared `integration_settings` table (its own `opencti_connector_settings`
// tracks the service account alongside stream-specific fields, see `opencti-connector/schema.ts`),
// but still needs a standard platformConfigured/tenantConfigured signal here: widened separately
// from `SourceSchema`/`INTEGRATION_SOURCES` so the generic `configure`/`getSettings` endpoints below
// stay exhaustive over the real `integration_settings.source` column.
const CONNECTOR_STATUS_SOURCES = [...INTEGRATION_SOURCES, 'opencti', 'default_threats'] as const;
const ConnectorStatusSourceSchema = z.enum(CONNECTOR_STATUS_SOURCES);

export const integrationsRouter = (procedure: TenantProcedure) => router({
  getSettings: procedure
    .input(z.object({ source: SourceSchema }))
    .output(IntegrationSettingsSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).integrationSettings.getIntegrationSettings(input.source)),

  getConnectorsStatus: procedure
    .output(z.record(ConnectorStatusSourceSchema, z.object({
      platformConfigured: z.boolean(),
      tenantConfigured: z.boolean(),
      url: z.string().nullable(),
    })))
    .query(async ({ ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      // A client's tenantId comes straight off the `x-tenant-id` header, unchecked by
      // `authenticatedProcedure` — unlike a connector's, already bound to its own service
      // account's tenant — so a client claiming another tenant must be rejected here, not
      // just treated as "no tenant" (which would otherwise leak that tenant's config/URLs).
      const isAuthorizedTenant = await isOriginAuthorizedForItsTenant(origin, (t) => scoped.tenants.callerReachesTenant(t));
      const tenantId = isAuthorizedTenant ? origin.tenantId : undefined;
      const settings = tenantId ? await scoped.integrationSettings.getAllIntegrationSettings() : [];
      const openctiSettings = tenantId ? await scoped.openctiConnector.getSettings(tenantId) : null;
      const defaultThreats = tenantId ? await scoped.defaultThreats.getSettings(tenantId) : null;
      return resolveConnectorConfigurations(
        config().connectors,
        tenantId,
        settings,
        openctiSettings,
        defaultThreats === null ? null : defaultThreatsRunState(defaultThreats),
      );
    }),

  configure: procedure
    .input(z.object({ source: SourceSchema, serviceAccountId: z.uuid().nullable() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const canManage = await services.withOrigin(origin).capabilities.hasManageSecurity();
      if (!canManage) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // Verify the service account exists and belongs to this tenant (view is scoped)
      if (input.serviceAccountId !== null) {
        const sa = await services.withOrigin(origin).serviceAccounts.getServiceAccount(input.serviceAccountId);
        if (!sa) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Service account not found' });
        }
      }
      await services.withOrigin(origin).integrationSettings.configureIntegration(input.source, input.serviceAccountId);
    }),
});
