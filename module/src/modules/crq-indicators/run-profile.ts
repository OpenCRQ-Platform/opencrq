import { z } from 'zod';

/**
 * What a run computes beyond the baseline, which every run computes: the technique removals, the
 * what-if of each priced CVE, the levers of every control or of the named ones, every plan or the
 * named ones.
 */
export interface CrqRunProfile {
  readonly techniques: boolean,
  readonly cves: boolean,
  readonly levers: 'all' | ReadonlyArray<string>,
  readonly plans: 'all' | ReadonlyArray<string>,
}

/** A figure family a run may compute beyond its baseline, and the token it records it under. */
export type CrqRunFamily = 'techniques' | 'cves' | 'levers' | 'plans';

export const FULL_RUN_PROFILE: CrqRunProfile = { techniques: true, cves: true, levers: 'all', plans: 'all' };
export const PRICE_RUN_PROFILE: CrqRunProfile = { techniques: false, cves: false, levers: [], plans: [] };

export const leversRunProfile = (controlIds: 'all' | ReadonlyArray<string>): CrqRunProfile =>
  ({ ...PRICE_RUN_PROFILE, levers: controlIds === 'all' ? 'all' : [...new Set(controlIds)].sort() });

export const planRunProfile = (planId: string): CrqRunProfile => ({ ...PRICE_RUN_PROFILE, plans: [planId] });

export const techniquesRunProfile: CrqRunProfile = { ...PRICE_RUN_PROFILE, techniques: true };

export const cvesRunProfile: CrqRunProfile = { ...PRICE_RUN_PROFILE, cves: true };

const mergeSubjects = (one: 'all' | ReadonlyArray<string>, other: 'all' | ReadonlyArray<string>): 'all' | ReadonlyArray<string> =>
  (one === 'all' || other === 'all' ? 'all' : [...new Set([...one, ...other])].sort());

/** The run computing both, which is what one booking owes two asks folded into it. */
export const mergeRunProfiles = (one: CrqRunProfile, other: CrqRunProfile): CrqRunProfile => ({
  techniques: one.techniques || other.techniques,
  cves: one.cves || other.cves,
  levers: mergeSubjects(one.levers, other.levers),
  plans: mergeSubjects(one.plans, other.plans),
});

export const computesSubject = (subjects: 'all' | ReadonlyArray<string>, id: string): boolean =>
  subjects === 'all' || subjects.includes(id);

/**
 * The profile as the run row records it: a family computed whole is its own token, a named subject
 * is `<family>:<id>`. A price run records no token.
 */
export const runProfileTokens = (profile: CrqRunProfile): Array<string> => {
  const named = (family: CrqRunFamily, subjects: 'all' | ReadonlyArray<string>): Array<string> =>
    (subjects === 'all' ? [family] : subjects.map((id) => `${family}:${id}`));
  return [
    ...(profile.techniques ? ['techniques'] : []),
    ...(profile.cves ? ['cves'] : []),
    ...named('levers', profile.levers),
    ...named('plans', profile.plans),
  ];
};

export interface FamilyRun {
  readonly runId: string,
  readonly riskScenarioId: string,
  /** Its place among its scenario's runs read with it, newest first, as the database orders them: an order, not a count of the history. */
  readonly rank: number,
  readonly profile: ReadonlyArray<string>,
}

export interface FamilyRunOwnership {
  readonly owns: (runId: string, subjectId: string) => boolean,
  /** The runs that own at least one subject, which are the only ones whose rows are read. */
  readonly runIds: ReadonlyArray<string>,
}

/**
 * Which run each subject of a family is read from: per scenario, the newest run that computed that
 * subject, whether it named it or computed the whole family. A run computing the whole family owns
 * every subject no newer run named, those it holds no row for included, so a control or a plan that
 * left the scenario since an older run stops being read from that older run.
 */
export const familyRunOwnership = (runs: ReadonlyArray<FamilyRun>, family: CrqRunFamily): FamilyRunOwnership => {
  const prefix = `${family}:`;
  const owned = new Map<string, { whole: boolean, subjects: ReadonlySet<string> }>();
  for (const scenarioRuns of Map.groupBy(runs, (run) => run.riskScenarioId).values()) {
    const claimed = new Set<string>();
    for (const run of scenarioRuns.toSorted((one, other) => one.rank - other.rank)) {
      if (run.profile.includes(family)) {
        owned.set(run.runId, { whole: true, subjects: new Set(claimed) });
        break;
      }
      const named = run.profile.filter((token) => token.startsWith(prefix)).map((token) => token.slice(prefix.length));
      const subjects = new Set(named.filter((id) => !claimed.has(id)));
      if (subjects.size > 0) {
        owned.set(run.runId, { whole: false, subjects });
      }
      named.forEach((id) => claimed.add(id));
    }
  }
  return {
    owns: (runId, subjectId) => {
      const ownership = owned.get(runId);
      if (ownership === undefined) {
        return false;
      }
      return ownership.whole ? !ownership.subjects.has(subjectId) : ownership.subjects.has(subjectId);
    },
    runIds: [...owned.keys()],
  };
};

const SubjectsSchema = z.union([z.literal('all'), z.array(z.string())]);

const BookedPayloadSchema = z.looseObject({
  /* A payload queued before runs had a `cves` family carries none, and asked for no CVE what-if. */
  profile: z.object({ techniques: z.boolean(), cves: z.boolean().default(false), levers: SubjectsSchema, plans: SubjectsSchema }).optional().catch(undefined),
});

/** What a `crq-simulation` booking computes. A payload without a profile was booked as a full run. */
export const bookedRunProfile = (payload: unknown): CrqRunProfile =>
  BookedPayloadSchema.parse(payload).profile ?? FULL_RUN_PROFILE;

/** The payload a `crq-simulation` booking carries once `asked` folds into it: the run computing both. */
export const foldCrqSimulationPayload = (held: unknown, asked: unknown): Record<string, unknown> => {
  const parsed = BookedPayloadSchema.parse(held);
  return { ...parsed, profile: mergeRunProfiles(parsed.profile ?? FULL_RUN_PROFILE, bookedRunProfile(asked)) };
};
