/*
 * Drizzle ORM's table type system requires `any` in generic type parameters
 * (e.g., PgTableWithColumns<any>, PgText<any>). These are structural requirements
 * of the Drizzle API surface, not unsafe runtime usages.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { exists, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns, PgUUID } from 'drizzle-orm/pg-core';
import type { EventOrigin, GatekeeperResult, OpenCtiReaderAccess, SecurityPolicyRule } from '../policy';
import { clearedMarkings, nativeClearanceReader } from './native-marking-policies';
import { userIsSuperAdmin } from './super-admin-policies';

/**
 * The OpenCTI markings a client origin may read, or `undefined` when the origin carries no marking
 * scope (a job, a job run borrowing a person's origin, a connector, an internal read): only a person's
 * own request is narrowed, and only by the tenant procedure that asked OpenCTI, so a score still
 * blends every mirrored object (opencrq #31, a stated limit).
 * `null` is a person whose markings OpenCTI did not answer, or whose tenant has no OpenCTI connection
 * to ask: they hold no clearance, so they read only the unmarked mirrored objects (OpenAEV ADR-009:
 * failing closed means seeing less, never nothing).
 */
export const originMarkingScope = (origin: EventOrigin): ReadonlyArray<string> | null | undefined => {
  if (origin.type !== 'client' || origin.job !== undefined) {
    return undefined;
  }
  return origin.markings;
};

/**
 * The origin without the OpenCTI scope the tenant procedure resolved for it. Its tenant rules and its
 * native clearance stay: only what OpenCTI's own rights hide from the person is no longer narrowed.
 */
export const withoutReaderScope = (origin: EventOrigin): EventOrigin =>
  (origin.type === 'client' ? { ...origin, markings: undefined, openctiAccess: undefined } : origin);

/**
 * Who the person is in OpenCTI (opencrq #35): `undefined` when the origin carries no marking scope or
 * no identity was resolved with it (nothing narrowed on organizations and members), `null` when
 * OpenCTI did not answer for them (they belong to no organization and no member list).
 */
export const originOpenCtiAccess = (origin: EventOrigin): OpenCtiReaderAccess | null | undefined => {
  if (originMarkingScope(origin) === undefined || origin.type !== 'client') {
    return undefined;
  }
  return origin.openctiAccess;
};

/** A list of ids as a SQL text array. */
const textArray = (values: ReadonlyArray<string>): SQL =>
  (values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`);

/** The reader's clearance as a SQL array; no answer from OpenCTI is no clearance. */
const markingArray = (markings: ReadonlyArray<string> | null): SQL => textArray(markings ?? []);

const OPENCTI_STIX_EXTENSION = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';

/**
 * The OpenCTI types organization sharing never restricts (`STIX_ORGANIZATIONS_UNRESTRICTED` in
 * opencti-graphql `schema/stixDomainObject.ts`, the subtypes of the location and meta families
 * spelled out since the mirror holds the type name alone).
 */
const ORGANIZATION_UNRESTRICTED_TYPES = [
  'Organization', 'Sector', 'Location', 'Region', 'Country', 'City', 'Administrative-Area', 'Position',
  'Marking-Definition', 'Label', 'External-Reference', 'Kill-Chain-Phase', 'Vocabulary',
];

/** The OpenCTI extension of a mirrored STIX body. */
const octiExtension = (data: SQL | PgColumn): SQL => sql`(${data}->'extensions'->${OPENCTI_STIX_EXTENSION})`;

/** A JSON value as an array, anything else (absent included) as an empty one. */
const jsonArray = (value: SQL): SQL => sql`(case when jsonb_typeof(${value}) = 'array' then ${value} else '[]'::jsonb end)`;

/**
 * Whether OpenCTI's organization sharing and authorized members admit the reader to a mirrored body,
 * as `checkUserCanAccessStixElement` (opencti-graphql `utils/access.ts`) decides once the markings
 * passed: an object restricted to members admits only a member (an entry naming the user, one of
 * their organizations or groups, or ALL, whose group restriction they meet); otherwise an object of a
 * restricted type, when the platform has a platform organization and the reader is outside it, is
 * read only when it is shared with one of their organizations or is their own individual. A reader
 * OpenCTI did not answer for reads no member-restricted object and no object shared with organizations.
 */
const admittedBody = (data: SQL | PgColumn, access: OpenCtiReaderAccess | null): SQL => {
  const extension = octiExtension(data);
  const members = jsonArray(sql`${extension}->'authorized_members'`);
  const granted = jsonArray(sql`${extension}->'granted_refs_ids'`);
  const hasMembers = sql`(jsonb_array_length(${members}) > 0)`;
  const unrestricted = sql`(coalesce(${extension}->>'type', '') = any(${textArray(ORGANIZATION_UNRESTRICTED_TYPES)}))`;
  if (access === null) {
    return sql`(not ${hasMembers} and (${unrestricted} or jsonb_array_length(${granted}) = 0))`;
  }
  if (access.bypass) {
    return sql`true`;
  }
  const memberIds = textArray([access.userId, ...access.organizationIds, ...access.groupIds]);
  const groupIds = textArray(access.groupIds);
  const isMember = sql`exists(select 1 from jsonb_array_elements(${members}) as member where (member->>'id' = 'ALL' or member->>'id' = any(${memberIds})) and (select coalesce(bool_and(restriction = any(${groupIds})), true) from jsonb_array_elements_text(${jsonArray(sql`member->'groups_restriction_ids'`)}) as restriction))`;
  const outsidePlatformOrganization = access.platformOrganizationId !== null
    && !access.organizationIds.includes(access.platformOrganizationId);
  const sharedWithReader = outsidePlatformOrganization
    ? sql`(${extension}->>'id' = ${access.individualId ?? ''} or exists(select 1 from jsonb_array_elements_text(${granted}) as organization where organization = any(${textArray(access.organizationIds)})))`
    : sql`true`;
  return sql`((not ${hasMembers} or ${isMember}) and (${unrestricted} or ${hasMembers} or ${sharedWithReader}))`;
};

interface ThreatColumns {
  tenantId: SQL | PgColumn,
  stixId: SQL | PgColumn,
  kind: SQL | PgColumn,
  markingRefs: SQL | PgColumn,
}

/**
 * A row mirrored from OpenCTI a reader holding `markings` may see: its markings are all among the
 * reader's (multi-marking is AND; an unmarked row is visible to all) and its mirrored body, when the
 * mirror holds it, admits them on organization sharing and authorized members (opencrq #35). A
 * mirrored row whose markings are unknown (`null`, ingested before they were stored) is hidden.
 */
const readableMirroredThreat = (row: ThreatColumns, markings: ReadonlyArray<string> | null, access: OpenCtiReaderAccess | null | undefined): SQL => {
  const marked = sql`${row.markingRefs} is not null and ${row.markingRefs} <@ ${markingArray(markings)}`;
  const admitted = access === undefined
    ? sql`true`
    : sql`not exists(select 1 from opencti_stream_objects as threat_body where threat_body.tenant_id = ${row.tenantId} and threat_body.stix_id = ${row.stixId} and threat_body.deleted_at is null and not ${admittedBody(sql`threat_body.data`, access)})`;
  return sql`(${marked} and ${admitted})`;
};

/**
 * A mirrored row a reader OpenCTI did not answer for cannot read: the one the tenant procedure then
 * narrows on, and the rows a notice that threats are hidden speaks of.
 */
export const mirroredThreatHiddenFromUnresolvedReader = (row: ThreatColumns): SQL =>
  sql`(${row.kind} = 'connector' and not ${readableMirroredThreat(row, null, null)})`;

/**
 * The markings of an imported row the tenant defines, as a SQL array: a STIX file names whatever
 * markings its producer used (the MITRE ATT&CK copyright statement on every MITRE object), and only
 * a marking the tenant defines, created here or synced from its OpenCTI, can be held by a group.
 */
const tenantDefinedMarkings = (markingRefs: SQL | PgColumn, tenantId: string): SQL =>
  sql`array(select imported_ref from unnest(coalesce(${markingRefs}, '{}'::text[])) as imported_ref where exists(select 1 from marking_definitions as defined_marking where defined_marking.tenant_id = ${tenantId} and defined_marking.stix_id = imported_ref))`;

/**
 * A row the tenant imported (a STIX file a member uploaded, the default catalog) a person may see
 * (CTEM marking parity, G2 slice 3c-2): every marking it carries that the tenant defines is in their
 * OpenCRQ clearance, as `nativeMarkingPolicy` decides for a native object (AND, unmarked visible, the
 * super administrator reads all). A marking the tenant does not define does not restrict the row, a
 * stated limit: defining the marking, or syncing it from OpenCTI, enforces it from the next read.
 */
const readableImportedThreat = (row: ThreatColumns, reader: { userId: string, tenantId: string }): SQL =>
  sql`(${userIsSuperAdmin(reader.userId)} or ${tenantDefinedMarkings(row.markingRefs, reader.tenantId)} <@ ${clearedMarkings(reader.userId, reader.tenantId)})`;

/**
 * A threat row the origin may see: a row mirrored from OpenCTI follows the reader's OpenCTI markings
 * and sharing (when the tenant procedure resolved them), any other row follows the reader's OpenCRQ
 * clearance. `undefined` when the origin is narrowed on neither (a job, a connector, an internal read).
 */
const readableThreat = (row: ThreatColumns, origin: EventOrigin): SQL | undefined => {
  const markings = originMarkingScope(origin);
  const reader = nativeClearanceReader(origin);
  if (markings === undefined && reader === undefined) {
    return undefined;
  }
  const mirrored = markings === undefined ? sql`true` : readableMirroredThreat(row, markings, originOpenCtiAccess(origin));
  const imported = reader === undefined ? sql`true` : readableImportedThreat(row, reader);
  return sql`((${row.kind} <> 'connector' and ${imported}) or (${row.kind} = 'connector' and ${mirrored}))`;
};

type TableWithThreatMarkings = PgTableWithColumns<any> & {
  tenantId: PgColumn,
  stixId: PgColumn,
  kind: PgColumn,
  markingRefs: PgColumn,
};

/**
 * The writer falls back to `read` for a missing `update` / `delete`: both are spelled out as no
 * predicate so the writes keep exactly their tenant rules (an import upserting a STIX id the reader
 * cannot see must not turn into a silent no-op).
 */
const noWritePredicate = (): GatekeeperResult => undefined;

/** Read-only: writes keep their tenant rules, and the background jobs that score read everything. */
export const threatMarkingPolicy: SecurityPolicyRule<TableWithThreatMarkings> = {
  read: (origin, table): GatekeeperResult => readableThreat(table, origin),
  update: noWritePredicate,
  delete: noWritePredicate,
};

type TableWithAnalysisId = PgTableWithColumns<any> & { analysisId: PgUUID<any> };

/**
 * The same rule for a table hanging off a threat: its rows follow their threat. The parent is
 * named in raw SQL, as in `tenant-policies.ts`, since the threat schema imports this module.
 */
export const threatAnalysisMarkingPolicy: SecurityPolicyRule<TableWithAnalysisId> = {
  read: (origin, table): GatekeeperResult => {
    const row = { tenantId: sql`marked.tenant_id`, stixId: sql`marked.stix_id`, kind: sql`marked.kind`, markingRefs: sql`marked.marking_refs` };
    const readable = readableThreat(row, origin);
    return readable === undefined
      ? undefined
      : exists(sql`(select 1 from threat_analyses as marked where marked.id = ${table.analysisId} and ${readable})`);
  },
  update: noWritePredicate,
  delete: noWritePredicate,
};

/**
 * The markings a mirrored STIX body carries, read from its `object_marking_refs`; a body whose
 * markings are not an array (absent included) carries none, as OpenCTI writes an unmarked object.
 */
const bodyMarkings = (data: SQL | PgColumn): SQL =>
  sql`(case when jsonb_typeof(${data}->'object_marking_refs') = 'array' then array(select jsonb_array_elements_text(${data}->'object_marking_refs')) else '{}'::text[] end)`;

const readableBody = (data: SQL | PgColumn, markings: ReadonlyArray<string> | null, access: OpenCtiReaderAccess | null | undefined): SQL =>
  (access === undefined
    ? sql`(${bodyMarkings(data)} <@ ${markingArray(markings)})`
    : sql`(${bodyMarkings(data)} <@ ${markingArray(markings)} and ${admittedBody(data, access)})`);

type TableWithStixBody = PgTableWithColumns<any> & { data: PgColumn };

/**
 * A raw mirrored object (a report, a relationship, an identity) a reader may see: all its markings
 * are among the reader's, and its organization sharing and authorized members admit them (opencrq
 * #35). Read-only, as above: the connector writes and the rebuild job reads all.
 */
export const streamObjectMarkingPolicy: SecurityPolicyRule<TableWithStixBody> = {
  read: (origin, table): GatekeeperResult => {
    const markings = originMarkingScope(origin);
    return markings === undefined ? undefined : readableBody(table.data, markings, originOpenCtiAccess(origin));
  },
  update: noWritePredicate,
  delete: noWritePredicate,
};

type TableWithReportRef = PgTableWithColumns<any> & { tenantId: PgUUID<any>, reportStixId: PgColumn };

/**
 * Which threats a report cites follows the report: a reader who cannot read the report in OpenCTI
 * does not learn what it cites. A report with no mirror body left is hidden from a narrowed reader.
 */
export const reportRefMarkingPolicy: SecurityPolicyRule<TableWithReportRef> = {
  read: (origin, table): GatekeeperResult => {
    const markings = originMarkingScope(origin);
    if (markings === undefined) {
      return undefined;
    }
    return exists(sql`(select 1 from opencti_stream_objects as cited_report where cited_report.tenant_id = ${table.tenantId} and cited_report.stix_id = ${table.reportStixId} and ${readableBody(sql`cited_report.data`, markings, originOpenCtiAccess(origin))})`);
  },
  update: noWritePredicate,
  delete: noWritePredicate,
};

/* eslint-enable @typescript-eslint/no-explicit-any */
