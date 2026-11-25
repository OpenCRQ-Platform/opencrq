import { INTEGRATION_SOURCES, integrationSettings } from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import type { ProductConnection, ReaderProduct } from '../xtm/xtm-providers';
import { isOriginAuthorizedForItsTenant } from '../tenant-access-utils';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { defaultThreatsRunState, resolveConnectorConfigurations } from '../connectors/connector-configuration';
import { publicProductUrls } from '../xtm/public-product-urls';
import { assertOneServiceAccountChoice, NewServiceAccountSchema } from './new-service-account-input';

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

const browserUrl = async (product: ReaderProduct, connection: ProductConnection | undefined): Promise<string | null> =>
  connection ? await publicProductUrls.resolve(product, connection) : null;

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
      const credentials = config().connectors;
      const statuses = resolveConnectorConfigurations(
        credentials,
        tenantId,
        settings,
        openctiSettings,
        defaultThreats === null ? null : defaultThreatsRunState(defaultThreats),
      );
      // `url` is where a browser opens the product (the switcher, links to its objects), which the
      // connection's own URL, often an address inside the cluster, may not be.
      const [openctiUrl, openaevUrl] = await Promise.all([
        browserUrl('opencti', tenantId ? credentials?.opencti?.[tenantId] : undefined),
        browserUrl('openaev', tenantId ? credentials?.openaev?.[tenantId] : undefined),
      ]);
      return {
        ...statuses,
        opencti: { ...statuses.opencti, url: openctiUrl ?? statuses.opencti.url },
        openaev: { ...statuses.openaev, url: openaevUrl ?? statuses.openaev.url },
      };
    }),

  configure: procedure
    .input(z.object({
      source: SourceSchema,
      serviceAccountId: z.uuid().nullable().optional(),
      // Creates the account the integration runs as, in the same transaction as the binding.
      newServiceAccount: NewServiceAccountSchema.optional(),
    }))
    .output(z.object({ serviceAccountId: z.string().nullable() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      assertOneServiceAccountChoice(input);
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const canManage = await services.withOrigin(origin).capabilities.hasManageSecurity();
      if (!canManage) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const scoped = services.withOrigin(origin);
      if (input.newServiceAccount !== undefined) {
        const serviceAccountId = await scoped.integrationSettings
          .configureIntegrationWithNewServiceAccount(input.source, input.newServiceAccount.name);
        return { serviceAccountId };
      }
      const serviceAccountId = input.serviceAccountId ?? null;
      // Verify the service account exists and belongs to this tenant (view is scoped)
      if (serviceAccountId !== null) {
        const sa = await scoped.serviceAccounts.getServiceAccount(serviceAccountId);
        if (!sa) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Service account not found' });
        }
      }
      await scoped.integrationSettings.configureIntegration(input.source, serviceAccountId);
      return { serviceAccountId };
    }),
});
