import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export const mitreTactics = pgTable('mitre_tactics', {
  id: uuid('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  url: text('url'),
  order: integer('order').notNull(),
});

export const mitreTechniques = pgTable('mitre_techniques', {
  id: uuid('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  nameFolded: text('name_folded').generatedAlwaysAs(sql`fold_text(name)`),
  description: text('description'),
  url: text('url'),
  parentTechniqueId: uuid('parent_technique_id').references((): AnyPgColumn => mitreTechniques.id),
  isSubtechnique: boolean('is_subtechnique').notNull().default(false),
  revoked: boolean('revoked').notNull().default(false),
  replacedByTechniqueId: uuid('replaced_by_technique_id').references((): AnyPgColumn => mitreTechniques.id, { onDelete: 'set null' }),
});

export const mitreTechniqueTactics = pgTable('mitre_technique_tactics', {
  techniqueId: uuid('technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  tacticId: uuid('tactic_id').notNull().references(() => mitreTactics.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.techniqueId, table.tacticId] }),
]);

export const mitreMitigations = pgTable('mitre_mitigations', {
  id: uuid('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  url: text('url'),
});

export const mitreMitigationTechniques = pgTable('mitre_mitigation_techniques', {
  mitigationId: uuid('mitigation_id').notNull().references(() => mitreMitigations.id, { onDelete: 'cascade' }),
  techniqueId: uuid('technique_id').notNull().references(() => mitreTechniques.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.mitigationId, table.techniqueId] }),
]);
