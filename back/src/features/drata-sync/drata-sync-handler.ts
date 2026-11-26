import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices, NonRetryableError } from '@app/module';
import type { DrataRequirementOutput, DrataSyncPayload } from './drata-types';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { createDrataClient } from './drata-api-client';
import { buildMirrorInput, isImportedFramework } from './drata-mapping-utils';

const { logTrace, logTraceFromError } = createLogger({ feature: 'drata-sync' });

export const drataSyncHandler: JobHandler<DrataSyncPayload> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }

  const drataConfig = config().connectors?.drata?.[ctx.tenantId];
  if (!drataConfig) {
    throw new NonRetryableError('drata connector config is missing for this tenant (connectors.drata)');
  }

  const services = createServices([...allServiceDefinitions], dbEngine.db);
  const origin = { type: 'connector' as const, serviceAccountId: ctx.payload.serviceAccountId, tenantId: ctx.tenantId, job: { jobKind: ctx.kind, interactive: ctx.interactive } };
  const svc = services.withOrigin(origin);

  const connectorId = await svc.integrationSettings.getConnectorId('drata');
  if (!connectorId) {
    throw new NonRetryableError('integration_settings row for drata not found — configure the integration first');
  }

  const syncStartedAt = new Date();
  const client = createDrataClient(drataConfig.url, drataConfig.api_key, drataConfig.workspace_id, ctx.signal);

  logTrace('Starting Drata sync', { tenantId: ctx.tenantId, attempt: ctx.attempt });

  try {
    await ctx.updateProgress({ message: 'Listing Drata frameworks' });
    const allFrameworks = await client.listFrameworks();
    const frameworks = allFrameworks.filter(isImportedFramework);
    logTrace(`Frameworks resolved: ${frameworks.length} imported of ${allFrameworks.length}`);

    await ctx.updateProgress({ processedTotal: 0, expectedTotal: frameworks.length });

    // The requirement payload does not carry its in-scope/ready flags; the same
    // listing is re-fetched with each filter and the flags derived by set membership.
    const requirementsByFramework = new Map<number, Array<DrataRequirementOutput>>();
    const inScopeIdsByFramework = new Map<number, Set<number>>();
    const readyIdsByFramework = new Map<number, Set<number>>();
    let processed = 0;
    for (const framework of frameworks) {
      if (ctx.signal.aborted) {
        return;
      }
      await ctx.updateProgress({ message: `Fetching requirements of framework ${processed + 1} of ${frameworks.length}: ${framework.name}` });
      requirementsByFramework.set(framework.id, await client.listFrameworkRequirements(framework.id));
      const inScope = await client.listFrameworkRequirements(framework.id, { isInScope: true });
      inScopeIdsByFramework.set(framework.id, new Set(inScope.map((r) => r.id)));
      const ready = await client.listFrameworkRequirements(framework.id, { isReady: true });
      readyIdsByFramework.set(framework.id, new Set(ready.map((r) => r.id)));
      processed++;
      logTrace(`Framework ${processed} of ${frameworks.length} fetched: ${framework.name}, ${requirementsByFramework.get(framework.id)?.length ?? 0} requirements`);
      await ctx.updateProgress({ processedTotal: processed });
    }

    if (ctx.signal.aborted) {
      return;
    }
    await ctx.updateProgress({ message: 'Fetching Drata controls' });
    const controls = await client.listControls();
    logTrace(`Controls fetched: ${controls.length}`);

    const mirror = buildMirrorInput({
      frameworks,
      requirementsByFramework,
      inScopeIdsByFramework,
      readyIdsByFramework,
      controls,
      syncedAt: syncStartedAt,
    });

    if (ctx.signal.aborted) {
      return;
    }
    await ctx.updateProgress({ message: 'Replacing the Drata mirror' });
    await svc.drata.replaceMirror(mirror);
    logTrace(`Mirror replaced: ${mirror.frameworks.length} frameworks, ${mirror.controls.length} controls`);

    await ctx.updateProgress({ message: 'Recording the sync watermark' });
    await svc.integrationSettings.markSynced('drata', syncStartedAt);
    logTrace('Drata sync complete', {
      frameworks: mirror.frameworks.length,
      requirements: mirror.frameworks.reduce((sum, f) => sum + f.requirements.length, 0),
      controls: mirror.controls.length,
    });
  } catch (err) {
    // The runtime logs the run's outcome, at the level its retry or move to the DLQ calls for.
    logTraceFromError(err, 'Drata sync failed', { tenantId: ctx.tenantId, attempt: ctx.attempt });
    throw err;
  }
};
