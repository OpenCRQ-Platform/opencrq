import type { TestServices } from '../setup/test-context';

/** Fills the projection the scoped reads filter on, as the job does after a link edit. */
export const recomputePrimaryAssetReach = (services: TestServices, tenantId: string) =>
  services.withOrigin({ type: 'job', tenantId, jobKind: 'primary-asset-reach-recompute', interactive: false })
    .assetDependencies.recomputePrimaryAssetReach();
