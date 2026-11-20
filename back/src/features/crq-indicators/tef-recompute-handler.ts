import type { JobHandler } from '@app/module';
import { allServiceDefinitions, createServices } from '@app/module';
import { dbEngine } from '../../engines/db';

export interface TefRecomputePayload extends Record<string, unknown> {
  riskScenarioId: string,
}

/** Fired by an organization firmography save; no user is attributed to a recompute. */
export const tefRecomputeHandler: JobHandler<TefRecomputePayload> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }

  const services = createServices([...allServiceDefinitions], dbEngine.db)
    .withOrigin({ type: 'job', tenantId: ctx.tenantId, jobKind: ctx.kind, interactive: ctx.interactive });

  // The scenario may have switched to manual between enqueue and execution: a stale job must not
  // insert an estimate nobody reads.
  const scenario = await services.riskScenarios.getRiskScenario(ctx.payload.riskScenarioId);
  if (scenario?.tefMode !== 'auto') {
    return;
  }

  await services.crqIndicators.resolveAutoTef(ctx.payload.riskScenarioId, ctx.tenantId);
};
