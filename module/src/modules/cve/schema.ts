import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { CveSource } from './sources';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';
import { CVE_SOURCE_VALUES } from './sources';

export const cve = pgTable('cve', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cveId: text('cve_id').notNull(),
  cvss: doublePrecision('cvss'),
  cvssVector: text('cvss_vector'),
  // NVD's flag beside a CVSS 2.0 vector, which carries no user interaction metric. Kept when NVD
  // moves the CVE to a later version, so it is read only while `cvss_vector` is 2.0.
  cvssV2UserInteractionRequired: boolean('cvss_v2_user_interaction_required'),
  cvssUpdatedAt: timestamp('cvss_updated_at', { withTimezone: true, mode: 'date' }),
  epss: doublePrecision('epss'),
  epssUpdatedAt: timestamp('epss_updated_at', { withTimezone: true, mode: 'date' }),
  kev: boolean('kev'),
  kevUpdatedAt: timestamp('kev_updated_at', { withTimezone: true, mode: 'date' }),
  // What CISA orders and by when, verbatim from the KEV catalogue. The due date is almost always
  // in the past (a KEV deadline runs two to three weeks from the listing), so it dates the order
  // rather than raising an alarm.
  kevRequiredAction: text('kev_required_action'),
  kevDueDate: timestamp('kev_due_date', { withTimezone: true, mode: 'date' }),
  // A ` ; ` separated list, mostly of URLs, occasionally with free text between them.
  kevNotes: text('kev_notes'),
  // `Known` or `Unknown`, verbatim from the KEV catalogue, which never states the negative.
  kevRansomwareUse: text('kev_ransomware_use'),
  // The CNA's own remediation prose, one line per maintained release line, read from the MITRE
  // record. The NVD passes the affected ranges through but never this field, and on a vendor that
  // declares the last version each line reached it is the only place a version to move to exists.
  vendorSolution: text('vendor_solution'),
  cveTitle: text('cve_title'),
  cveTitleFolded: text('cve_title_folded').generatedAlwaysAs(sql`fold_text(cve_title)`),
  cveDescription: text('cve_description'),
  // NULL and an empty array answer different questions: NULL is "no usable CWE", `{}` would be a resolved-to-nothing claim.
  cwe: text('cwe').array(),
  // When the NVD record was first read for the remediation of a flaw a finding carries, whatever it
  // stated: a record with no reference, or a CVE NVD does not know, is read once, not on every pass.
  // Set once and moving no `updated_at`, which the technique resolution reads as the CVE changing.
  remediationReadAt: timestamp('remediation_read_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('cve_tenantid_cveid_idx').on(table.tenantId, table.cveId),
  index('cve_updated_at_idx').on(table.updatedAt.desc().nullsFirst()),
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('cve_id_tenant_id_uq').on(table.id, table.tenantId),
]);

defineSecurityPolicies(cve, tenantIsolationPolicy);

/**
 * What one source last reported on one CVE, holding only the fields that source states.
 *
 * The fields in force on `cve` are resolved from these rows by a per-field source order.
 *
 * `cvss`, `cvss_vector`, `cvss_version`, `cvss_v2_user_interaction_required` and `cvss_updated_at` are one tuple: a score is only ever
 * read together with the vector of the same source.
 */
export const cveSourceObservations = pgTable('cve_source_observations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  source: text('source').$type<CveSource>().notNull(),
  cvss: doublePrecision('cvss'),
  cvssVector: text('cvss_vector'),
  cvssVersion: text('cvss_version'),
  cvssV2UserInteractionRequired: boolean('cvss_v2_user_interaction_required'),
  cvssUpdatedAt: timestamp('cvss_updated_at', { withTimezone: true, mode: 'date' }),
  cwe: text('cwe').array(),
  title: text('title'),
  description: text('description'),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  lastModifiedAt: timestamp('last_modified_at', { withTimezone: true, mode: 'date' }),
  epss: doublePrecision('epss'),
  epssUpdatedAt: timestamp('epss_updated_at', { withTimezone: true, mode: 'date' }),
  kev: boolean('kev'),
  kevUpdatedAt: timestamp('kev_updated_at', { withTimezone: true, mode: 'date' }),
  kevRequiredAction: text('kev_required_action'),
  kevDueDate: timestamp('kev_due_date', { withTimezone: true, mode: 'date' }),
  kevNotes: text('kev_notes'),
  kevRansomwareUse: text('kev_ransomware_use'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  unique('cve_source_observations_cve_source_uq').on(table.cveId, table.source),
  check('cve_source_observations_source_ck', sql`${table.source} IN (${sql.raw(CVE_SOURCE_VALUES.map((value) => `'${value}'`).join(', '))})`),
]);

defineSecurityPolicies(cveSourceObservations, tenantIsolationPolicy);

/**
 * A reference published on a CVE record: advisory, patch, mailing list, exploit.
 *
 * Stored only for the flaws a tenant's findings carry: a threat names many CVEs no asset has, and
 * the remediation surfaces only ever read from a finding.
 *
 * `tags` is null for a CVE the NVD has not analysed yet, which is the normal state of a freshly
 * published one: the tag list comes from the analysis pass, never from the CNA. A reader therefore
 * cannot take the absence of a `Patch` tag as the absence of a patch.
 *
 * `tenant_id` is denormalised (it is reachable through `cve_id`) so the rows use the plain tenant
 * policy rather than a correlated subquery on every write of a bulk sync.
 */
export const cveReferences = pgTable('cve_references', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  source: text('source'),
  tags: text('tags').array(),
}, (table) => [
  uniqueIndex('cve_references_cveid_url_idx').on(table.cveId, table.url),
]);

defineSecurityPolicies(cveReferences, tenantIsolationPolicy);

/**
 * One affected version range stated by the CNA, for one product.
 *
 * The feed states what is affected; a fixed version is this product's own inference from the upper
 * bound, which is why the columns keep the feed's words. `affected_up_to_included` carries the
 * distinction the CNA drew: an excluded bound names the first fixed version, an included one only
 * says the fix lands somewhere after it.
 *
 * Only ranges carrying an upper bound are stored: a row without one states no remediation, which is
 * all this table is read for.
 */
export const cveAffectedVersions = pgTable('cve_affected_versions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cveId: uuid('cve_id').notNull().references(() => cve.id, { onDelete: 'cascade' }),
  vendor: text('vendor'),
  product: text('product'),
  affectedFrom: text('affected_from'),
  affectedUpTo: text('affected_up_to').notNull(),
  affectedUpToIncluded: boolean('affected_up_to_included').notNull().default(false),
}, (table) => [
  // Vendor and product are nullable and a CNA routinely omits both, so two ranges of one CVE would
  // collide as distinct rows under the default null semantics and the replace would insert twice.
  unique('cve_affected_versions_cveid_product_bound_uq')
    .on(table.cveId, table.vendor, table.product, table.affectedUpTo)
    .nullsNotDistinct(),
]);

defineSecurityPolicies(cveAffectedVersions, tenantIsolationPolicy);
