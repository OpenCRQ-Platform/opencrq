import type { TestServices } from '../setup/test-context';

/** Fills the table the three mixture readers serve from, as the job does for the pairs carrying a scenario. */
export const recomputeAttackOutcomeMixtures = (services: TestServices, tenantId: string, options: { at?: Date } = {}) =>
  services.withOrigin({ type: 'job', tenantId, jobKind: 'attack-outcome-mixture-recompute', interactive: false })
    .attackOutcomes.recomputeAttackOutcomeMixtures(options);
