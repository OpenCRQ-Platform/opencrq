import type { JobCatalogueKind } from '../../modules/jobs/catalogue';
import { crqIndicatorSettings } from '../../modules/crq-indicator-settings/schema';
import { crqIndicatorTefInputs } from '../../modules/crq-indicators/schema';
import { Tenant_Acme } from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';
import { DEMO_PHISHING_FAILURE_RATE, DEMO_PHISHING_MEASURED_DAYS_AGO, DEMO_WORLDS, MANUAL_TEF_INPUT } from './crq-simulations-seeder';

const acmeJobOrigin = (jobKind: JobCatalogueKind) => ({ type: 'job', tenantId: Tenant_Acme, jobKind, interactive: false } as const);

/**
 * The last of the estate: what the attack run engine reads besides the assets, findings and threats,
 * so the price taken between the two phases is the one the boot price pass takes again.
 */
registerPlatformSeed('crq-mixtures', async ({ db, services, now }) => {
  // The mixtures weigh each actor by its activity dates, which only the activity job folds. Left to
  // the first boot, that fold changes the admitted actors after the anchors are priced, and the price
  // pass then writes a last point on another attacker set than the whole history (#3253).
  await services.withOrigin(acmeJobOrigin('threat-activity-recompute')).threatActivity.recomputeActivity({ now, isDailyBooking: true });
  // The engine and the anchor runs read the stored mixtures, which only the job's own method fills.
  await services.withOrigin(acmeJobOrigin('attack-outcome-mixture-recompute')).attackOutcomes.recomputeAttackOutcomeMixtures({ at: now });

  await db.insert(crqIndicatorTefInputs).values({
    ...MANUAL_TEF_INPUT,
    updatedAt: new Date(now.getTime() - 180 * 86_400_000),
  });

  await db.insert(crqIndicatorSettings).values({
    tenantId: Tenant_Acme,
    iterations: DEMO_WORLDS,
    phishingFailureRate: DEMO_PHISHING_FAILURE_RATE,
    phishingFailureMeasuredOn: new Date(now.getTime() - DEMO_PHISHING_MEASURED_DAYS_AGO * 86_400_000).toISOString().slice(0, 10),
  }).onConflictDoNothing();
});
