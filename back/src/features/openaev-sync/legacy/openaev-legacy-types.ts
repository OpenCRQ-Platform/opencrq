import { z } from 'zod';
import type { openaevPageSchema } from '../openaev-types';

/** One page of an OpenAEV search endpoint, as `openaevPageSchema` parses it. */
export type OpenaevPage<T extends z.ZodType> = z.infer<ReturnType<typeof openaevPageSchema<T>>>;

export const exerciseSimpleSchema = z.looseObject({
  exercise_id: z.string(),
  exercise_name: z.string().nullable().optional(),
  exercise_status: z.string(),
  exercise_updated_at: z.string().nullable().optional(),
});

export const exerciseOutputSchema = z.looseObject({
  exercise_id: z.string(),
  exercise_scenario: z.string().nullable().optional(),
});
export type ExerciseOutput = z.infer<typeof exerciseOutputSchema>;

export const scenarioOutputSchema = z.looseObject({
  scenario_id: z.string(),
  scenario_name: z.string().nullable().optional(),
});
export type ScenarioOutput = z.infer<typeof scenarioOutputSchema>;

export const injectExpectationResultSchema = z.looseObject({
  sourceId: z.string().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  sourcePlatform: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  result: z.string().nullable().optional(),
});
export type InjectExpectationResult = z.infer<typeof injectExpectationResultSchema>;

export const injectExpectationOutputSchema = z.looseObject({
  inject_expectation_id: z.string(),
  inject_expectation_type: z.string(),
  inject_expectation_status: z.string().nullable().optional(),
  inject_expectation_inject: z.string().nullable().optional(),
  inject_expectation_asset: z.string().nullable().optional(),
  inject_expectation_score: z.number().nullable().optional(),
  inject_expectation_expected_score: z.number().nullable().optional(),
  inject_expectation_results: z.array(injectExpectationResultSchema).default([]),
});
export type InjectExpectationOutput = z.infer<typeof injectExpectationOutputSchema>;

export const attackPatternSchema = z.looseObject({
  attack_pattern_id: z.string(),
  attack_pattern_external_id: z.string(),
  attack_pattern_name: z.string().nullable().optional(),
});

export const injectSchema = z.looseObject({
  inject_id: z.string(),
  inject_title: z.string().nullable().optional(),
  inject_attack_patterns: z.array(attackPatternSchema).default([]),
});
export type InjectResponse = z.infer<typeof injectSchema>;

export const relatedFindingOutputSchema = z.looseObject({
  finding_id: z.string(),
  finding_type: z.string().nullable().optional(),
  finding_value: z.string().nullable().optional(),
  finding_updated_at: z.string().nullable().optional(),
  finding_assets: z.array(z.looseObject({ asset_id: z.string() })).default([]),
  finding_inject: z.looseObject({ inject_id: z.string() }).nullable().optional(),
  finding_simulation: z.looseObject({ exercise_id: z.string().nullable().optional(), exercise_name: z.string().nullable().optional() }).nullable().optional(),
});
export type RelatedFindingOutput = z.infer<typeof relatedFindingOutputSchema>;

/** One finished exercise the run still has to read, with the identity its evidence is written under. */
export interface LegacyExerciseEntry {
  exerciseId: string,
  openaevTenantId: string,
  exerciseUpdatedAt: string | null,
  exerciseName: string | null,
}

/** What a legacy run checkpoints so that a retry resumes after the phases and the exercises already done. */
export interface OpenaevLegacyResumeState {
  exerciseEntries: Array<LegacyExerciseEntry>,
  currentExerciseIndex: number,
  /** Start of the run that wrote the checkpoint: the instant the run-wide CVE enumeration judges against. */
  syncStartedAt: string,
  /** Set once the CVE findings phase has completed for every OpenAEV tenant, so a resumed run skips it. */
  cveFindingsComplete: boolean,
}

/** Raw (CVE, asset) pairs harvested from CVE findings, before CVE and asset UUID resolution. */
export interface OpenaevCveRawRow {
  cveIdentifier: string,
  /** The OpenAEV asset id, not yet resolved to a supporting asset. */
  supportingAssetId: string,
  findingId: string,
  injectId: string | null,
  simulationId: string | null,
  simulationName: string | null,
  findingUpdatedAt: string | null,
}
