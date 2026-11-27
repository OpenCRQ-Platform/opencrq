// Import order = execution order.
// Each seeder registers itself via registerPlatformSeed() at import time.

import './users-seeder';
import './tenants-seeder';
import './roles-seeder';
import './groups-seeder';
import './organizations-seeder';
import './financial-profiles-seeder';
import './declared-estate-seeder';
import './service-accounts-seeder';
import './integration-settings-seeder';
import './primary-assets-seeder';
import './supporting-assets-seeder';
import './identities-seeder';
import './primary-users-seeder';
import './host-criticality-seeder';
import './asset-groups-seeder';
import './asset-dependencies-seeder';
import './risk-scenarios-seeder';
import './risk-tolerances-seeder';
import './scenario-loss-estimates-seeder';
import './notifications-seeder';
import './cve-seeder';
import './threats-seeder';
import './asset-findings-seeder';
import './finding-metrics-seeder';
import './asset-posture-history-seeder';
import './capability-assessments-seeder';
import './crq-simulations-seeder';
import './large-estate-seeder';
import './treatment-plans-seeder';
import './budget-reviews-seeder';
import './compliance-assessments-seeder';
import './requirements-seeder';
// Last of the estate: the mixtures read every scenario and threat the estate seeders wrote.
import './crq-mixtures-seeder';
