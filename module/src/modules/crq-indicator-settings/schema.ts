import { sql } from 'drizzle-orm';
import { check, date, doublePrecision, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { DeclaredCriticality } from '../supporting-assets/constants';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityWritePolicy } from '../../security/policies';
import { tenants } from '../tenants';

export const crqIndicatorSettings = pgTable('crq_indicator_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  iterations: integer('iterations').notNull().default(1000),
  exposureWeightInternetFacing: doublePrecision('exposure_weight_internet_facing').notNull().default(1.0),
  exposureWeightInternal: doublePrecision('exposure_weight_internal').notNull().default(0.4),
  // Noisy-OR diminishing-returns factor (γ) for stacking capabilities on a technique.
  // γ=1: every stacked control counts fully; γ=0: only the strongest counts (legacy "max" mode).
  susceptibilityGamma: doublePrecision('susceptibility_gamma').notNull().default(0.7),
  // Days a test result keeps counting as a measurement in the finding score. Null means the window
  // is off, which is the behaviour of an estate that never set it.
  measuredValidityDays: integer('measured_validity_days'),
  unknownCriticalityCountsAs: text('unknown_criticality_counts_as').notNull().default('low').$type<DeclaredCriticality>(),
  unknownExposureCountsAs: text('unknown_exposure_counts_as').notNull().default('internal').$type<UnknownExposureCountsAs>(),
  // The share of people who failed the tenant's last phishing simulation, and the day it was measured.
  // Both null is no declaration; one without the other is meaningless, so the table refuses it.
  phishingFailureRate: doublePrecision('phishing_failure_rate'),
  phishingFailureMeasuredOn: date('phishing_failure_measured_on', { mode: 'string' }),
}, (table) => [
  check('crq_indicator_settings_phishing_failure_rate_ck', sql`${table.phishingFailureRate} BETWEEN 0 AND 1`),
  check(
    'crq_indicator_settings_phishing_failure_pair_ck',
    sql`(${table.phishingFailureRate} IS NULL) = (${table.phishingFailureMeasuredOn} IS NULL)`,
  ),
]);

defineSecurityPolicies(crqIndicatorSettings, tenantIsolationPolicy, manageSecurityWritePolicy);
