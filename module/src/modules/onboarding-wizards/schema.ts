import { foreignKey, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { organizations } from '../organizations/schema';
import { tenants } from '../tenants';

/** The Get started wizard of one risk scope. */
export const onboardingWizards = pgTable('onboarding_wizards', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull(),
}, (table) => [
  // Also the index serving the foreign key below.
  unique('onboarding_wizards_organization_uq').on(table.organizationId),
  foreignKey({
    name: 'onboarding_wizards_organization_tenant_fk',
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [organizations.id, organizations.tenantId],
  }).onDelete('cascade'),
]);

defineSecurityPolicies(onboardingWizards, tenantIsolationPolicy);
