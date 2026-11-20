import type { JobCatalogueKind } from '../modules/jobs/catalogue';
import type { PlatformSeedServices } from './platform-seed-registry';
import { Tenant_Acme } from './data/ids';

const acmeJobOrigin = (jobKind: JobCatalogueKind) => ({ type: 'job', tenantId: Tenant_Acme, jobKind, interactive: false } as const);

/**
 * Loads the Default Threats dataset for the priced tenant and records the load as the sync job does.
 * The module cannot fetch the file: the platform passes the load, and a seed run without it (tests)
 * leaves the dataset to the first boot's sync.
 */
export type SeedDefaultThreatsLoad = (services: Pick<ReturnType<PlatformSeedServices['withOrigin']>, 'defaultThreats'>, tenantId: string) => Promise<void>;

/**
 * The derived tables the attack run engine reads, which the first boot's recompute wave would
 * otherwise write after the anchors are priced: the boot price pass then stood on a reach, lifts,
 * projections and finding scores the history never saw, and the last point of the trend left the
 * anchors by a factor of six (#3253). These jobs read in parallel, so they run on the pool between the
 * estate's commit and the anchor pricing, never inside the seed's single-connection transaction. The
 * mixtures are taken again last, since they stand on what the others wrote. The control posture is
 * derived first (assessments from the compliance mirror, then the per-technique test results), as the
 * boot's capability derivation would: on the seeded assessments alone, the boot reprice of a fresh
 * start moved Acme Bank from 9.9M to 1.7M in one day. The Default Threats dataset is loaded ahead of
 * all of them when the platform passes its load: left to the first boot's sync, the threats it brings
 * moved the last point of the trend 60% off the anchors, and the recorded load makes that sync ask
 * for the file only if it changed. A failed load is the boot's again, as without the seed.
 *
 * Kept out of `./seeders`: importing a seeder module registers it, and an import from here ahead of
 * `./seeders` would move that seeder to the front of the run order.
 */
export const recomputeEngineInputs = async (services: PlatformSeedServices, now: Date, loadDefaultThreats: SeedDefaultThreatsLoad | null = null) => {
  if (loadDefaultThreats !== null) {
    try {
      await loadDefaultThreats(services.withOrigin(acmeJobOrigin('default-threats-sync')), Tenant_Acme);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('[platform-seed]   The Default Threats dataset could not be loaded, the first boot loads it:', error);
    }
    // The activity dates fold the loaded threats too, as the boot's activity job would.
    await services.withOrigin(acmeJobOrigin('threat-activity-recompute')).threatActivity.recomputeActivity({ now, isDailyBooking: true });
  }
  const derivation = services.withOrigin(acmeJobOrigin('capability-derivation'));
  const derived = await derivation.controlCapabilities.rederiveAssessments();
  await derivation.controlValidation.measureTechniqueTestResults({ now, crossings: derived.crossings });
  await services.withOrigin(acmeJobOrigin('asset-criticality-lift-recompute')).supportingAssets.recomputeCriticalityLifts();
  await services.withOrigin(acmeJobOrigin('primary-asset-reach-recompute')).assetDependencies.recomputePrimaryAssetReach();
  await services.withOrigin(acmeJobOrigin('threat-list-projection-recompute')).threatAnalyses.recomputeListProjections();
  await services.withOrigin(acmeJobOrigin('finding-score-recompute')).findingScore.recomputeFindingScores();
  await services.withOrigin(acmeJobOrigin('attack-outcome-mixture-recompute')).attackOutcomes.recomputeAttackOutcomeMixtures({ at: now });
};
