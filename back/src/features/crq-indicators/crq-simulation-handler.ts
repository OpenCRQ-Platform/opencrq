import type { JobHandler } from '@app/module';
import { allServiceDefinitions, bookedRunProfile, createServices } from '@app/module';
import type { CrqBaselinePayload } from './crq-simulation-origin';
import { dbEngine } from '../../engines/db';
import { createLogger } from '../../utils/logger';
import { imageVersion } from '../../utils/platform-version';
import { crqRunOrigin } from './crq-simulation-origin';

const { logTrace } = createLogger({ feature: 'crq-simulation' });

export const crqSimulationHandler: JobHandler<CrqBaselinePayload> = async (ctx) => {
  if (ctx.signal.aborted) {
    return;
  }

  const services = createServices([...allServiceDefinitions], dbEngine.db)
    .withOrigin(crqRunOrigin(ctx.payload, ctx.tenantId, ctx.kind, ctx.interactive));

  const outcome = await services.crqIndicators.runAttackRunEngine(
    ctx.payload.riskScenarioId,
    ctx.tenantId,
    ctx.signal,
    bookedRunProfile(ctx.payload),
    ctx.jobId,
    {
      priceBudgetReviews: true,
      appVersion: imageVersion(),
    },
  );
  if (outcome != null && 'skipped' in outcome) {
    logTrace('Attack run simulation skipped', { riskScenarioId: ctx.payload.riskScenarioId, reason: outcome.skipped });
  }
};
