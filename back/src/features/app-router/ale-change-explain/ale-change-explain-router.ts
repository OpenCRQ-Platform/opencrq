import { CHANGE_CATEGORY_KEYS, CHANGE_GROUP_KINDS, CHANGE_GROUP_SORT_KEYS, CHANGE_TABS, EVIDENCE_STATES, SCENARIO_TABS, SEVERITY_BANDS } from '@app/module';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { isFeatureEnabled } from '../../feature-flags/feature-flags';
import { TIME_ZONE_INPUT } from '../time-zone';

const ComparedRunSchema = z.object({
  id: z.uuid(),
  createdAt: z.date(),
  readAt: z.date(),
});

const ChangeValueSchema = z.union([z.number(), z.string()]).nullable();

const ChangeLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scenario-tab'), tab: z.enum(SCENARIO_TABS) }),
  z.object({ kind: z.literal('technique'), externalId: z.string() }),
  z.object({ kind: z.literal('control'), controlId: z.uuid() }),
  z.object({ kind: z.literal('asset'), supportingAssetId: z.uuid() }),
  z.object({ kind: z.literal('cve'), cveId: z.string() }),
  z.object({ kind: z.literal('cve-findings'), cveId: z.string(), state: z.enum(EVIDENCE_STATES) }),
]).nullable();

const ChangeDirectionSchema = z.enum(['up', 'down', 'none']);

const ChangeItemSchema = z.object({
  kind: z.enum(['run-figure', 'actor-class-share', 'model-setting', 'technique-family', 'control', 'asset', 'tef-read', 'tef-input', 'cve', 'cve-group', 'asset-group']),
  key: z.string(),
  label: z.string().nullable(),
  link: ChangeLinkSchema,
});

const ChangeEventSchema = z.object({
  category: z.enum(CHANGE_CATEGORY_KEYS),
  moment: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('recorded'), at: z.iso.datetime() }),
    z.object({ kind: z.literal('run'), runId: z.uuid() }),
    z.object({ kind: z.literal('balance') }),
  ]),
  direction: ChangeDirectionSchema,
  item: ChangeItemSchema,
  sentence: z.object({ key: z.string(), parts: z.record(z.string(), z.union([z.string(), z.number()])) }),
  values: z.object({
    format: z.enum(['frequency', 'share', 'currency', 'count', 'text']),
    before: ChangeValueSchema,
    after: ChangeValueSchema,
  }).nullable(),
  group: z.object({
    kind: z.enum(CHANGE_GROUP_KINDS),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    up: z.number().int(),
    down: z.number().int(),
    bands: z.array(z.object({ from: z.enum(SEVERITY_BANDS).nullable(), to: z.enum(SEVERITY_BANDS).nullable(), count: z.number().int() })),
  }).optional(),
});

const ChangeGroupRowSchema = z.object({
  item: ChangeItemSchema,
  from: z.enum(SEVERITY_BANDS).nullable(),
  to: z.enum(SEVERITY_BANDS).nullable(),
  assets: z.number().int().nullable(),
  at: z.iso.datetime(),
  direction: ChangeDirectionSchema,
});

const RunChangesSchema = z.object({
  before: ComparedRunSchema,
  after: ComparedRunSchema,
  runs: z.array(ComparedRunSchema),
  categories: z.array(z.object({ key: z.enum(CHANGE_CATEGORY_KEYS), tabs: z.array(z.enum(CHANGE_TABS)) })),
  events: z.array(ChangeEventSchema),
});

const RunCurvePointSchema = z.object({
  id: z.uuid(),
  createdAt: z.date(),
  ale: z.number().nullable(),
  tef: z.number().nullable(),
  susceptibility: z.number().nullable(),
  magnitude: z.number().nullable(),
});

const ComparedRunsInput = z.object({ riskScenarioId: z.uuid(), firstRunId: z.uuid(), secondRunId: z.uuid() });

export const aleChangeExplainRouter = (procedure: TenantProcedure) => router({
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the scenario's runs, one point each: the page's curve draws every run
  getRunCurve: procedure
    .input(z.object({ riskScenarioId: z.uuid() }))
    .output(z.array(RunCurvePointSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).aleChangeExplain.getRunCurve(input.riskScenarioId)),

  getRunChanges: procedure
    .input(ComparedRunsInput.extend({ timeZone: TIME_ZONE_INPUT }))
    .output(RunChangesSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).aleChangeExplain.getRunChanges(input, { techniqueCoverage: isFeatureEnabled('technique-coverage-changes') }) ?? null),

  getRunChangeGroup: procedure
    .input(ComparedRunsInput.extend({
      category: z.enum(CHANGE_CATEGORY_KEYS),
      kind: z.enum(CHANGE_GROUP_KINDS),
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      search: z.string().max(64),
      sort: z.object({ by: z.enum(CHANGE_GROUP_SORT_KEYS), desc: z.boolean() }).nullable().default(null),
      offset: z.number().int().min(0),
      limit: z.number().int().min(1).max(100),
    }))
    .output(z.object({ rows: z.array(ChangeGroupRowSchema), total: z.number().int() }).nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).aleChangeExplain.getRunChangeGroup({ ...input, from: new Date(input.from), to: new Date(input.to) }) ?? null),
});
