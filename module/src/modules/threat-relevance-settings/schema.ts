import { integer, pgTable, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { manageSecurityWritePolicy } from '../../security/policies';
import { tenants } from '../tenants';
import { THREAT_RELEVANCE_DEFAULTS } from './constants';

export const threatRelevanceSettings = pgTable('threat_relevance_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  actHalfLifeObservedDays: integer('act_half_life_observed_days').notNull()
    .default(THREAT_RELEVANCE_DEFAULTS.actHalfLifeObservedDays),
  actHalfLifeAuthoredDays: integer('act_half_life_authored_days').notNull()
    .default(THREAT_RELEVANCE_DEFAULTS.actHalfLifeAuthoredDays),
  confidenceGate: integer('confidence_gate').notNull()
    .default(THREAT_RELEVANCE_DEFAULTS.confidenceGate),
  unknownActivityAgeDays: integer('unknown_activity_age_days').notNull()
    .default(THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays),
});

defineSecurityPolicies(threatRelevanceSettings, tenantIsolationPolicy, manageSecurityWritePolicy);
