import { uuidv7 } from 'uuidv7';
import { newError, StructuredError } from '@app/utils';
import type {
  AssessmentAxis,
  AssessmentEventType,
  AssessmentMode,
  CapabilityFunction,
  CoverageBucket,
  StrengthRung,
} from './constants';
import type { AnswerCapabilityReading, DrataCapabilityReading, PooledAssessment } from './pooled-derivation';
import type { AssessmentSourceRow, AssessmentValue } from './repository';
import type { ResolvedCapabilityPosture, ResolvedPosture, ScopePostureOverrideInput, TenantPostureInput } from './scope-posture';
import type { InferRepository } from '../../../registry';
import type { EventOrigin } from '../../../security';
import { originTenantId, requireClientTenantId, requireTenantId } from '../../../security';
import { defineService } from '../../../registry';
import { attackOutcomesService } from '../../attack-outcomes';
import { complianceAssessmentsService } from '../../compliance-assessments/service';
import { deriveCapabilityAssessments, DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS } from '../../drata/capability-derivation';
import { drataService } from '../../drata/service';
import { riskScenariosService } from '../../risk-scenarios';
import { computeControlLinks } from '../control-links-utils';
import { ASSESSMENT_AXES, DERIVATION_WRITER, DRATA_SOURCE } from './constants';
import { isScoredEdge } from './effective-coverage';
import { replayEffectivenessHistory } from './effectiveness-history';
import { poolCapabilityAssessments } from './pooled-derivation';
import { rewindScopePosture } from './posture-at-date';
import { controlCapabilityRepository } from './repository';
import { resolveScopePosture, resolveScopePostures } from './scope-posture';

interface ClassifiedPosture {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
}

const classifyPostureChange = (
  before: ClassifiedPosture | undefined,
  after: ClassifiedPosture,
): AssessmentEventType | null => {
  if (!before) {
    return 'assessment_set';
  }
  const moved: Array<AssessmentEventType> = [];
  if (before.strengthRung !== after.strengthRung) {
    moved.push('strength_change');
  }
  if (before.coverageBucket !== after.coverageBucket) {
    moved.push('coverage_change');
  }
  return moved.length > 1 ? 'assessment_change' : moved.at(0) ?? null;
};

/**
 * Classifies the overlay row itself, never the resolved value: a dimension forced to the value the
 * tenant already holds moved the declaration although the resolved posture did not move.
 */
const scopeOverrideEventType = (
  before: ScopePostureOverrideInput | undefined,
  after: ScopePostureOverrideInput,
): AssessmentEventType | null => {
  // An empty declaration on an undeclared pair stores nothing, so it is not a transition.
  if (!before && after.strengthRung === null && after.coverageBucket === null) {
    return null;
  }
  return classifyPostureChange(before, after);
};

export type PostureDimension = AssessmentAxis;

export interface ScopePostureDeclaration {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
  comment: string | null,
}

/** The tenant pair is null when the tenant never assessed the control; the date is null with no overlay row. */
export interface ScopedCapabilityPosture extends ResolvedCapabilityPosture {
  comment: string | null,
  tenantStrengthRung: StrengthRung | null,
  tenantCoverageBucket: CoverageBucket | null,
  scopeDeclaredAt: Date | null,
}

/** `undefined` on either side is no declaration at all. */
export interface ScopePostureTransition {
  before: ScopePostureOverrideInput | undefined,
  after: ScopePostureOverrideInput | undefined,
}

/** The axes whose tenant-level value moved: a lever is priced from them, so its step no longer holds. */
export interface PostureCrossing {
  capabilityId: string,
  axes: Array<AssessmentAxis>,
  /**
   * The risk scopes whose own figures moved, which reprice whatever axis they pin: a test result is
   * read per scope, never through the tenant's declaration. Absent, the axes decide.
   */
  organizationIds?: Array<string>,
}

export interface DerivationOutcome {
  written: number,
  cleared: number,
  crossings: Array<PostureCrossing>,
}

type AxisValues = {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
} | undefined;

/** No row reads as no value on strength and coverage, so a first assessment moves both. */
const movedAxes = (before: AxisValues, after: AxisValues): Array<AssessmentAxis> =>
  ASSESSMENT_AXES.filter((axis) => {
    switch (axis) {
      case 'strength':
        return (before?.strengthRung ?? null) !== (after?.strengthRung ?? null);
      case 'coverage':
        return (before?.coverageBucket ?? null) !== (after?.coverageBucket ?? null);
    }
  });

/** What the engine reads for a control with no assessment row. */
const UNASSESSED: AxisValues = { strengthRung: 'L0', coverageBucket: 'L0' };

const crossingOf = (capabilityId: string, before: AxisValues, after: AxisValues): Array<PostureCrossing> => {
  const axes = movedAxes(before, after);
  return axes.length === 0 ? [] : [{ capabilityId, axes }];
};

export class NoDerivedAssessmentError extends StructuredError {
  override readonly name: string = 'NoDerivedAssessmentError';

  constructor() {
    super('No source feeds this control: there is nothing to re-attach it to', { data: {} });
  }
}

export class IncompleteFirstDeclarationError extends StructuredError {
  override readonly name: string = 'IncompleteFirstDeclarationError';

  constructor() {
    super('A first declaration names both axes', { data: {} });
  }
}

type Repo = InferRepository<typeof controlCapabilityRepository>;

type AxisModes = Pick<AssessmentValue, 'strengthMode' | 'coverageMode'>;

/** No row reads as the columns' defaults: strength and coverage declared. */
const modeOf = (row: AxisModes | undefined, axis: AssessmentAxis): AssessmentMode => {
  switch (axis) {
    case 'strength':
      return row?.strengthMode ?? 'manual';
    case 'coverage':
      return row?.coverageMode ?? 'manual';
  }
};

const modeSwitches = (before: AxisModes | undefined, after: AxisModes): { [K in keyof AxisModes]: AssessmentMode | null } => ({
  strengthMode: modeOf(before, 'strength') === after.strengthMode ? null : after.strengthMode,
  coverageMode: modeOf(before, 'coverage') === after.coverageMode ? null : after.coverageMode,
});

interface PoolingDeps {
  drata: { getLiveControlReadiness: () => Promise<Array<{ code: string, isReady: boolean }>> },
  complianceAssessments: { getPublishedControlReadings: () => Promise<Array<AnswerCapabilityReading>> },
}

type DerivedValue = Omit<AssessmentValue, 'comment'>;

interface DeclaredAxes {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
}

const NOTHING_DECLARED: DeclaredAxes = { strengthRung: null, coverageBucket: null };

export interface DrataReadingOfCapability extends DrataCapabilityReading {
  capabilityExternalId: string,
}

const readDrata = async (repo: Repo, deps: Pick<PoolingDeps, 'drata'>): Promise<Array<DrataReadingOfCapability>> => {
  const readiness = await deps.drata.getLiveControlReadiness();
  const derived = deriveCapabilityAssessments(new Map(readiness.map((control) => [control.code, control.isReady])));
  const ids = await repo.findCapabilityIdsByExternalIds(derived.map((entry) => entry.capabilityExternalId));
  return derived.flatMap((entry) => {
    const capabilityId = ids.get(entry.capabilityExternalId);
    return capabilityId === undefined ? [] : [{
      capabilityId,
      capabilityExternalId: entry.capabilityExternalId,
      strengthRung: entry.strengthRung,
      coverageBucket: entry.coverageBucket,
      coverageMeasured: entry.coverageMeasured,
      atCeiling: entry.atCeiling,
    }];
  });
};

const computePooled = async (repo: Repo, deps: PoolingDeps): Promise<Array<PooledAssessment>> => {
  const [readings, answers] = await Promise.all([
    readDrata(repo, deps),
    deps.complianceAssessments.getPublishedControlReadings(),
  ]);
  return poolCapabilityAssessments(readings, answers);
};

const fedAxesOf = (entry: PooledAssessment): Array<AssessmentAxis> =>
  ASSESSMENT_AXES.filter((axis) => axis === 'coverage' || entry.strengthRung !== null);

const coverageOf = (
  existing: DerivedValue | undefined,
  entry: PooledAssessment,
  derivedAxes: ReadonlyArray<AssessmentAxis>,
  declaredCoverage: CoverageBucket | null,
): Pick<DerivedValue, 'coverageBucket' | 'coverageMode' | 'coverageBasis'> => {
  if (!derivedAxes.includes('coverage')) {
    if (existing) {
      return { coverageBucket: existing.coverageBucket, coverageMode: existing.coverageMode, coverageBasis: existing.coverageBasis };
    }
    if (declaredCoverage !== null) {
      return { coverageBucket: declaredCoverage, coverageMode: 'manual', coverageBasis: 'declared' };
    }
  }
  return { coverageBucket: entry.coverageBucket, coverageMode: 'auto', coverageBasis: entry.coverageBasis };
};

/**
 * The pooled entry on the axes the derivation holds, the stored row on the others. An axis neither
 * holds comes from `declared`; a strength with no value at all leaves no row to write, and the
 * result is null.
 */
const mergeDerived = (
  existing: DerivedValue | undefined,
  entry: PooledAssessment,
  derivedAxes: ReadonlyArray<AssessmentAxis>,
  declared: DeclaredAxes = NOTHING_DECLARED,
): DerivedValue | null => {
  const strength = entry.strengthRung !== null && derivedAxes.includes('strength')
    ? { strengthRung: entry.strengthRung, strengthMode: 'auto' as const }
    : existing
      ? { strengthRung: existing.strengthRung, strengthMode: existing.strengthMode }
      : declared.strengthRung && { strengthRung: declared.strengthRung, strengthMode: 'manual' as const };
  if (!strength) {
    return null;
  }
  return { ...strength, ...coverageOf(existing, entry, derivedAxes, declared.coverageBucket) };
};

const sourceRowsOf = (assessmentId: string, tenantId: string, entry: PooledAssessment, axes: ReadonlyArray<AssessmentAxis>) =>
  axes.flatMap((axis) => (axis === 'strength' ? entry.strengthSources : entry.coverageSources)
    .map((source) => ({ assessmentId, tenantId, axis, source })));

const eventSourceRowsOf = (eventId: string, tenantId: string, entry: PooledAssessment, axes: ReadonlyArray<AssessmentAxis>) =>
  axes.flatMap((axis) => (axis === 'strength' ? entry.strengthFeeds : entry.coverageFeeds)
    .map((feed) => ({ id: uuidv7(), eventId, tenantId, axis, ...feed })));

const sourceKeys = (rows: ReadonlyArray<{ axis: AssessmentAxis, source: string }>): string =>
  rows.map((row) => `${row.axis}:${row.source}`).sort().join(',');

const sameDerivedValue = (a: DerivedValue, b: DerivedValue): boolean =>
  a.strengthRung === b.strengthRung
  && a.coverageBucket === b.coverageBucket
  && a.coverageBasis === b.coverageBasis;

const autoAxesOf = (row: Pick<DerivedValue, 'strengthMode' | 'coverageMode'> | undefined): Array<AssessmentAxis> =>
  (row === undefined
    ? [...ASSESSMENT_AXES]
    : ASSESSMENT_AXES.filter((axis) => (axis === 'strength' ? row.strengthMode : row.coverageMode) === 'auto'));

/**
 * Writes every control from the pooled entries, never a manual axis. A derived axis that only
 * assessments fed, and that no source feeds any more, is cleared: the whole row when both axes are,
 * else that axis alone, which drops to the engine's unassessed floor and loses its sources. An axis
 * Drata fed keeps its last value when Drata's evidence leaves the mirror, and is cleared like the
 * others once the evidence mapping keys no pair for its control. An entry with no strength
 * feeds the coverage of an existing row and creates none.
 */
const writePooledAssessments = async (
  repo: Repo,
  tenantId: string,
  entries: ReadonlyArray<PooledAssessment>,
): Promise<DerivationOutcome> => {
  const drataEvidenced = new Set((await repo.findCapabilityIdsByExternalIds([...DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS])).values());
  const rows = await repo.findAssessmentRows(tenantId);
  const sources = await repo.findAssessmentSources(tenantId);
  const rowByCapability = new Map(rows.map((row) => [row.capabilityId, row]));
  const sourcesByAssessment = Map.groupBy(sources, (row: AssessmentSourceRow) => row.assessmentId);
  const outcome: DerivationOutcome = { written: 0, cleared: 0, crossings: [] };

  for (const entry of entries) {
    const existing = rowByCapability.get(entry.capabilityId);
    const fedAxes = fedAxesOf(entry);
    const derivedAxes = autoAxesOf(existing).filter((axis) => fedAxes.includes(axis));
    const next = derivedAxes.length === 0 ? null : mergeDerived(existing, entry, derivedAxes);
    if (next === null) {
      continue;
    }
    if (existing && sameDerivedValue(existing, next)
      && sourceKeys((sourcesByAssessment.get(existing.id) ?? []).filter((row) => derivedAxes.includes(row.axis)))
        === sourceKeys(sourceRowsOf(existing.id, tenantId, entry, derivedAxes))) {
      continue;
    }
    const [written] = await repo.upsertDerivedAssessmentValues({ capabilityId: entry.capabilityId, tenantId }, next, {
      strengthMode: existing?.strengthMode ?? 'auto',
      coverageMode: existing?.coverageMode ?? 'auto',
    });
    if (!written) {
      continue;
    }
    await repo.deleteAssessmentSources(written.id, derivedAxes);
    await repo.insertAssessmentSources(sourceRowsOf(written.id, tenantId, entry, derivedAxes));
    const eventId = uuidv7();
    await repo.insertAssessmentEvent({
      id: eventId,
      capabilityId: entry.capabilityId,
      tenantId,
      userId: null,
      connector: DERIVATION_WRITER,
      type: classifyPostureChange(existing, next) ?? 'sources_changed',
      oldStrength: existing?.strengthRung ?? null,
      newStrength: next.strengthRung,
      oldCoverage: existing?.coverageBucket ?? null,
      newCoverage: next.coverageBucket,
      comment: null,
      createdAt: new Date(),
    });
    await repo.insertAssessmentEventSources(eventSourceRowsOf(eventId, tenantId, entry, derivedAxes));
    const crossings = crossingOf(entry.capabilityId, existing, next);
    outcome.crossings.push(...crossings);
    if (existing) {
      rowByCapability.set(entry.capabilityId, { ...existing, ...next });
    }
    outcome.written += 1;
  }

  const fedAxesByCapability = new Map(entries.map((entry) => [entry.capabilityId, fedAxesOf(entry)]));
  for (const row of rowByCapability.values()) {
    const fedAxes = fedAxesByCapability.get(row.capabilityId) ?? [];
    const rowSources = sourcesByAssessment.get(row.id) ?? [];
    const unfedAxes = autoAxesOf(row).filter((axis) => {
      if (fedAxes.includes(axis)) {
        return false;
      }
      const axisSources = rowSources.filter((source) => source.axis === axis);
      // A Drata axis waits for its codes to come back to the mirror, unless the mapping no longer
      // evidences the control at all: then nothing can bring them back.
      return axisSources.length > 0
        && (!axisSources.some((source) => source.source === DRATA_SOURCE) || !drataEvidenced.has(row.capabilityId));
    });
    if (unfedAxes.length === 0) {
      continue;
    }
    const key = { capabilityId: row.capabilityId, tenantId };
    const bothCleared = unfedAxes.length === ASSESSMENT_AXES.length;
    const [cleared] = bothCleared ? await repo.deleteDerivedAssessment(key) : await repo.clearDerivedAxes(key, unfedAxes);
    if (!cleared) {
      continue;
    }
    if (!bothCleared) {
      await repo.deleteAssessmentSources(cleared.id, unfedAxes);
    }
    await repo.insertAssessmentEvent({
      id: uuidv7(),
      capabilityId: row.capabilityId,
      tenantId,
      userId: null,
      connector: DERIVATION_WRITER,
      type: 'assessment_cleared',
      oldStrength: row.strengthRung,
      newStrength: unfedAxes.includes('strength') ? null : row.strengthRung,
      oldCoverage: row.coverageBucket,
      newCoverage: unfedAxes.includes('coverage') ? null : row.coverageBucket,
      comment: null,
      createdAt: new Date(),
    });
    const crossings = crossingOf(row.capabilityId, row, bothCleared ? UNASSESSED : cleared);
    outcome.crossings.push(...crossings);
    outcome.cleared += 1;
  }
  return outcome;
};

const clientWriterOf = (origin: EventOrigin): { tenantId: string, userId: string } => {
  if (origin.type !== 'client') {
    throw newError('Tenant context required', { originType: origin.type });
  }
  return { tenantId: origin.tenantId, userId: origin.userId };
};

interface AssessmentDeclaration {
  /** Null leaves that axis as the row holds it. */
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
}

/**
 * Updates the row `existing` was read from under lock, or creates it. Undefined when a concurrent
 * first save created it after that read: the caller locks it and starts over.
 */
const writeAssessmentRow = async (
  repo: Repo,
  key: { capabilityId: string, tenantId: string },
  existing: object | undefined,
  values: AssessmentValue,
) => {
  const [written] = existing ? await repo.updateAssessmentValues(key, values) : await repo.insertAssessmentValues(key, values);
  return written;
};

const writeDeclaration = async (
  repo: Repo,
  key: { capabilityId: string, tenantId: string },
  userId: string,
  declaration: AssessmentDeclaration,
  comment: string | null,
): Promise<void> => {
  const { strengthRung, coverageBucket } = declaration;
  const existing = await repo.lockAssessmentForUpdate(key);
  if (!existing && (strengthRung === null || coverageBucket === null)) {
    throw new IncompleteFirstDeclarationError();
  }
  const next: AssessmentValue = {
    ...(strengthRung === null && existing
      ? { strengthRung: existing.strengthRung, strengthMode: existing.strengthMode }
      : { strengthRung: strengthRung ?? 'L0', strengthMode: 'manual' as const }),
    ...(coverageBucket === null && existing
      ? {
        coverageBucket: existing.coverageBucket,
        coverageMode: existing.coverageMode,
        coverageBasis: existing.coverageBasis,
      }
      : { coverageBucket: coverageBucket ?? 'L0', coverageMode: 'manual' as const, coverageBasis: 'declared' as const }),
    comment,
  };
  const declaredAxes = ASSESSMENT_AXES.filter((axis) => (axis === 'strength' ? strengthRung : coverageBucket) !== null);
  const written = await writeAssessmentRow(repo, key, existing, next);
  if (!written) {
    return writeDeclaration(repo, key, userId, declaration, comment);
  }
  await repo.deleteAssessmentSources(written.id, declaredAxes);
  const detached = autoAxesOf(existing).some((axis) => declaredAxes.includes(axis));
  const type = classifyPostureChange(existing, next) ?? (detached ? 'sources_changed' : null);
  if (type !== null) {
    await repo.insertAssessmentEvent({
      id: uuidv7(),
      ...key,
      userId,
      connector: null,
      type,
      oldStrength: existing?.strengthRung ?? null,
      newStrength: next.strengthRung,
      oldCoverage: existing?.coverageBucket ?? null,
      newCoverage: next.coverageBucket,
      ...modeSwitches(existing, next),
      comment,
      createdAt: new Date(),
    });
  }
};

/**
 * An axis already derived is refreshed along the way, unless the same save declares it. On a
 * control never assessed, the row is created with the declared axes at their declared values.
 */
const writeReattach = async (
  repo: Repo,
  key: { capabilityId: string, tenantId: string },
  userId: string,
  entry: PooledAssessment,
  axes: ReadonlyArray<AssessmentAxis>,
  declared: DeclaredAxes,
  comment: string | null,
): Promise<void> => {
  const existing = await repo.lockAssessmentForUpdate(key);
  const fedAxes = fedAxesOf(entry);
  const declaredAxes = ASSESSMENT_AXES.filter((axis) => (axis === 'strength' ? declared.strengthRung : declared.coverageBucket) !== null);
  const derivedAxes = [...new Set([...axes, ...autoAxesOf(existing)])]
    .filter((axis) => fedAxes.includes(axis) && !declaredAxes.includes(axis));
  const next = mergeDerived(existing, entry, derivedAxes, declared);
  if (next === null) {
    throw new NoDerivedAssessmentError();
  }
  const previousSources = existing ? await repo.findAssessmentSources(key.tenantId, existing.id) : [];
  const values: AssessmentValue = { ...next, comment };
  const written = await writeAssessmentRow(repo, key, existing, values);
  if (!written) {
    return writeReattach(repo, key, userId, entry, axes, declared, comment);
  }
  const nextSources = sourceRowsOf(written.id, key.tenantId, entry, derivedAxes);
  await repo.deleteAssessmentSources(written.id, derivedAxes);
  await repo.insertAssessmentSources(nextSources);
  const moved = !existing
    || !sameDerivedValue(existing, next)
    || existing.strengthMode !== next.strengthMode
    || existing.coverageMode !== next.coverageMode
    || sourceKeys(previousSources.filter((row) => derivedAxes.includes(row.axis))) !== sourceKeys(nextSources);
  if (!moved) {
    return;
  }
  const eventId = uuidv7();
  await repo.insertAssessmentEvent({
    id: eventId,
    ...key,
    userId,
    connector: DERIVATION_WRITER,
    type: classifyPostureChange(existing, values) ?? 'sources_changed',
    oldStrength: existing?.strengthRung ?? null,
    newStrength: next.strengthRung,
    oldCoverage: existing?.coverageBucket ?? null,
    newCoverage: next.coverageBucket,
    ...modeSwitches(existing, values),
    comment,
    createdAt: new Date(),
  });
  await repo.insertAssessmentEventSources(eventSourceRowsOf(eventId, key.tenantId, entry, derivedAxes));
};

/** The entry that feeds every one of `axes`. */
const pooledEntryOf = async (
  repo: Repo,
  deps: PoolingDeps,
  capabilityId: string,
  axes: ReadonlyArray<AssessmentAxis>,
): Promise<PooledAssessment> => {
  const entry = (await computePooled(repo, deps)).find((candidate) => candidate.capabilityId === capabilityId);
  if (!entry || axes.some((axis) => !fedAxesOf(entry).includes(axis))) {
    throw new NoDerivedAssessmentError();
  }
  return entry;
};

const withEventSources = async <Event extends { id: string }>(repo: Repo, tenantId: string, events: Array<Event>) => {
  if (events.length === 0) {
    return [];
  }
  const sources = await repo.findEventSources(tenantId, events.map((event) => event.id));
  const sourcesByEvent = Map.groupBy(sources, (source) => source.eventId);
  return events.map((event) => ({
    ...event,
    sources: (sourcesByEvent.get(event.id) ?? []).map(({ eventId: _eventId, ...source }) => source),
  }));
};

/** A declaration of neither dimension removes the row instead of storing two nulls. */
const writeScopeOverride = async (
  repo: Repo,
  key: { organizationId: string, capabilityId: string },
  tenantId: string,
  userId: string | null,
  before: (ScopePostureOverrideInput & { comment: string | null }) | undefined,
  after: ScopePostureDeclaration,
  journalComment: string | null,
): Promise<void> => {
  const type = scopeOverrideEventType(before, after);
  // A write that moves neither dimension nor the comment must not touch the row: the upsert would
  // bump `updated_at` and fire the data-changed trigger for a state nobody changed.
  if (type === null && (before?.comment ?? null) === after.comment) {
    return;
  }
  if (after.strengthRung === null && after.coverageBucket === null) {
    await repo.deleteScopeOverride(key);
  } else {
    await repo.upsertScopeOverrideValues(key, after);
  }
  if (userId === null || type === null) {
    return;
  }
  await repo.insertAssessmentEvent({
    id: uuidv7(),
    capabilityId: key.capabilityId,
    tenantId,
    organizationId: key.organizationId,
    userId,
    connector: null,
    type,
    oldStrength: before?.strengthRung ?? null,
    newStrength: after.strengthRung,
    oldCoverage: before?.coverageBucket ?? null,
    newCoverage: after.coverageBucket,
    comment: journalComment,
    createdAt: new Date(),
  });
};

export const controlCapabilityService = defineService(
  'controlCapabilities',
  controlCapabilityRepository,
).dependsOn(() => [attackOutcomesService, riskScenariosService, drataService, complianceAssessmentsService]).implement({
  // ─── Engine inputs (consumed by crq-indicators) ──────────────────────────────
  queryCapabilityResistanceInputs: async ({ repo }, scenarioTechniqueIds: Array<string>, tenantId: string) =>
    repo.queryCapabilityResistanceInputs(scenarioTechniqueIds, tenantId),

  // ─── Protected asset families (the only read path onto the table) ───────────

  /**
   * The families each named control protects. Every family-scoped credit the product gives is
   * gated on this read: no consumer joins the junction itself.
   */
  getProtectedFamilies: async ({ repo }, capabilityIds: Array<string>) => (
    capabilityIds.length === 0 ? [] : repo.findProtectedFamilies(capabilityIds)
  ),

  // ─── List / detail ───────────────────────────────────────────────────────────
  getControlCapabilities: async ({ repo, eventOrigin }) => {
    const tenantId = originTenantId(eventOrigin);
    return repo.findAllCapabilities(tenantId);
  },

  /** The catalogue id alone, for a read that must not go stale on every assessment event. */
  getControlCapabilityExternalId: async ({ repo }, id: string) => repo.findCapabilityExternalId(id),

  getControlCapability: async ({ repo, eventOrigin }, id: string) => {
    const tenantId = originTenantId(eventOrigin);
    return repo.findCapabilityById(id, tenantId);
  },

  /**
   * Weighs the stored attacker mixture of every (organization, attack outcome) pair its scenarios
   * use: only a surface listing these scenarios should call it. An `organizationId` narrows it to that
   * organization's scenarios.
   */
  getControlCapabilityRiskScenarios: async ({ repo, deps, eventOrigin }, id: string, organizationId?: string) => {
    const tenantId = originTenantId(eventOrigin);
    const capability = await repo.findCapabilityById(id, tenantId);
    if (!capability) {
      return [];
    }
    const techniqueMap = new Map(capability.edges.filter(isScoredEdge).map((e) => [
      e.techniqueId,
      { id: e.techniqueId, externalId: e.techniqueExternalId, name: e.techniqueName },
    ]));
    const { riskScenarios } = await computeControlLinks([...techniqueMap.values()], deps, organizationId);
    return riskScenarios;
  },

  getCapabilitiesForTechnique: async ({ repo, eventOrigin }, techniqueId: string) => {
    const tenantId = originTenantId(eventOrigin);
    return repo.findCapabilitiesForTechnique(techniqueId, tenantId);
  },

  // ─── Assessment (two-axis) ─────────────────────────────────────────────────────

  /**
   * Declares the named axes by hand, a null axis staying as it is: each declared axis turns manual
   * and drops its sources, so no later derivation moves it. A first
   * declaration names strength and coverage, since a row holds both.
   *
   * `reattachAxes` hands other axes back to auto in the same transaction, so a save never lands
   * half written. It goes first: on a control never assessed it creates the row a one-axis
   * declaration needs.
   *
   * The comment is optional: a blank one is stored as none, and every event the save writes carries it.
   *
   * Answers the axes whose value the save moved, read in its own transaction.
   */
  upsertAssessment: async (
    { repo, deps, atomic, eventOrigin },
    capabilityId: string,
    strengthRung: StrengthRung | null,
    coverageBucket: CoverageBucket | null,
    comment: string | null,
    reattachAxes: ReadonlyArray<AssessmentAxis> = [],
  ) => {
    const { tenantId, userId } = clientWriterOf(eventOrigin);
    const reason = comment === null || comment.trim() === '' ? null : comment;
    const valueOf: Record<AssessmentAxis, string | null> = { strength: strengthRung, coverage: coverageBucket };
    const declared = ASSESSMENT_AXES.filter((axis) => valueOf[axis] !== null);
    if (declared.length === 0 && reattachAxes.length === 0) {
      throw newError('A save names at least one axis');
    }
    if (declared.some((axis) => reattachAxes.includes(axis))) {
      throw newError('An axis is either declared or re-attached', { declared, reattach: reattachAxes });
    }
    await repo.validateCapabilityId(capabilityId);
    const pooledAxes = ASSESSMENT_AXES.filter((axis) => reattachAxes.includes(axis));
    const entry = pooledAxes.length > 0 ? await pooledEntryOf(repo, deps, capabilityId, pooledAxes) : null;
    return await atomic(async ({ repo: atomicRepo }) => {
      const key = { capabilityId, tenantId };
      const before = await atomicRepo.lockAssessmentForUpdate(key);
      if (entry !== null) {
        await writeReattach(atomicRepo, key, userId, entry, pooledAxes, { strengthRung, coverageBucket }, reason);
      }
      if (declared.length > 0) {
        await writeDeclaration(atomicRepo, key, userId, { strengthRung, coverageBucket }, reason);
      }
      const after = await atomicRepo.findTenantPosture(capabilityId, tenantId);
      return crossingOf(capabilityId, before, after);
    });
  },

  /** What Drata's mirror alone says of each control it reaches. */
  getDrataReadings: async ({ repo, deps, eventOrigin }) => {
    requireTenantId(eventOrigin);
    return readDrata(repo, deps);
  },

  /** What the derivation would write right now, for every control a source reaches. */
  getPooledAssessments: async ({ repo, deps, eventOrigin }) => {
    requireTenantId(eventOrigin);
    return computePooled(repo, deps);
  },

  /**
   * Recomputes every control of the tenant from the Drata mirror and the published answers, in one
   * write. The derivation job's path: it answers to no caller, so it runs under the job's origin.
   */
  rederiveAssessments: async ({ repo, deps, atomic, eventOrigin }): Promise<DerivationOutcome> => {
    if (eventOrigin.type !== 'job') {
      throw newError('Job origin required');
    }
    const tenantId = eventOrigin.tenantId;
    const entries = await computePooled(repo, deps);
    return await atomic(async ({ repo: atomicRepo }) => writePooledAssessments(atomicRepo, tenantId, entries));
  },

  // ─── Technique coverage overrides ────────────────────────────────────────────
  addTechnique: async (
    { atomic, eventOrigin },
    capabilityId: string,
    techniqueId: string,
    fn: CapabilityFunction,
  ) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.validateCapabilityId(capabilityId);
      await atomicRepo.validateTechniqueId(techniqueId);
      const inCatalogue = await atomicRepo.isTechniqueInCatalogue(capabilityId, techniqueId, fn);
      const existing = await atomicRepo.findTechniqueOverride({ capabilityId, tenantId, techniqueId, function: fn });
      // A technique the catalogue already covers on that function is never re-added: a tenant
      // who removed it restores it instead.
      if (inCatalogue || existing) {
        throw newError('Technique already covered');
      }
      await atomicRepo.upsertTechniqueOverride({ capabilityId, tenantId, techniqueId, function: fn }, { kind: 'added' });
    });
  },

  removeTechnique: async (
    { atomic, eventOrigin },
    capabilityId: string,
    techniqueId: string,
    fn: CapabilityFunction,
  ) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.validateCapabilityId(capabilityId);
      const existing = await atomicRepo.findTechniqueOverride({ capabilityId, tenantId, techniqueId, function: fn });
      // Removing an addition erases it: there is no "removed addition" state to restore from.
      if (existing?.kind === 'added') {
        await atomicRepo.deleteTechniqueOverride({ capabilityId, tenantId, techniqueId, function: fn });
        return;
      }
      if (existing?.kind === 'removed') {
        return;
      }
      if (!await atomicRepo.isTechniqueInCatalogue(capabilityId, techniqueId, fn)) {
        throw newError('Not Found');
      }
      await atomicRepo.upsertTechniqueOverride({ capabilityId, tenantId, techniqueId, function: fn }, { kind: 'removed' });
    });
  },

  restoreTechnique: async (
    { atomic, eventOrigin },
    capabilityId: string,
    techniqueId: string,
    fn: CapabilityFunction,
  ) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await atomic(async ({ repo: atomicRepo }) => {
      const existing = await atomicRepo.findTechniqueOverride({ capabilityId, tenantId, techniqueId, function: fn });
      if (existing?.kind !== 'removed') {
        throw newError('Not Found');
      }
      await atomicRepo.deleteTechniqueOverride({ capabilityId, tenantId, techniqueId, function: fn });
    });
  },

  /** Without a function, discards the control's overrides on every function. */
  resetTechniqueOverrides: async ({ repo, eventOrigin }, capabilityId: string, fn?: CapabilityFunction) => {
    const tenantId = requireClientTenantId(eventOrigin);
    await repo.deleteTechniqueOverridesForCapability({ capabilityId, tenantId, function: fn });
  },

  // ─── Scope posture overlay ───────────────────────────────────────────────────

  /**
   * A null scope is the tenant declaration itself, resolved through the same function with no
   * overlay row, so the reading outside any scope cannot drift from the one inside.
   */
  getResolvedPosture: async (
    { repo, eventOrigin },
    organizationId: string | null,
  ): Promise<Array<ScopedCapabilityPosture>> => {
    const tenantId = requireTenantId(eventOrigin);
    if (organizationId !== null) {
      await repo.validateOrganizationId(organizationId);
    }
    const [capabilityIds, assessments, overrides] = await Promise.all([
      repo.findCapabilityIds(),
      repo.findAssessments(tenantId),
      organizationId === null ? Promise.resolve([]) : repo.findScopeOverrides({ organizationId }),
    ]);
    const tenantByCapability = new Map<string, TenantPostureInput & { comment: string | null }>(
      assessments.map((row) => [row.capabilityId, row]),
    );
    const overrideByCapability = new Map<string, ScopePostureOverrideInput & { comment: string | null, updatedAt: Date }>(
      overrides.map((row) => [row.capabilityId, row]),
    );
    return resolveScopePostures(capabilityIds, tenantByCapability, overrideByCapability).map((posture) => {
      const tenant = tenantByCapability.get(posture.capabilityId);
      const override = overrideByCapability.get(posture.capabilityId);
      return {
        ...posture,
        // The justification belongs to the level that is being read: a scope reading never falls back
        // on the tenant's, which argues for a value the scope has just contradicted.
        comment: organizationId === null ? tenant?.comment ?? null : override?.comment ?? null,
        tenantStrengthRung: tenant?.strengthRung ?? null,
        tenantCoverageBucket: tenant?.coverageBucket ?? null,
        scopeDeclaredAt: override?.updatedAt ?? null,
      };
    });
  },

  /**
   * The scope's posture just before each cutoff, one map per cutoff in the order given, rewound
   * from today's declarations through the posture log, beside today's own. `logStartsAt` is when
   * that log begins, so a caller can say a cutoff predates it.
   */
  getScopePostureAt: async (
    { repo, eventOrigin },
    organizationId: string,
    cutoffs: ReadonlyArray<Date>,
  ): Promise<{ postures: Array<Map<string, ResolvedPosture>>, current: Map<string, ResolvedPosture>, logStartsAt: Date | null }> => {
    const tenantId = requireTenantId(eventOrigin);
    // Awaited in turn: called inside a transaction, it shares that transaction's one client.
    const capabilityIds = await repo.findCapabilityIds();
    const assessments = await repo.findAssessments(tenantId);
    const overrides = await repo.findScopeOverrides({ organizationId });
    const logStartsAt = await repo.findFirstPostureEventAt(tenantId, organizationId);
    const declared = {
      tenant: new Map(assessments.map((row) => [row.capabilityId, row])),
      scope: new Map(overrides.map((row) => [row.capabilityId, row])),
    };
    const eventsByCutoff: Array<Awaited<ReturnType<Repo['findFirstPostureEventsAfter']>>> = [];
    for (const cutoff of cutoffs) {
      eventsByCutoff.push(await repo.findFirstPostureEventsAfter(tenantId, organizationId, cutoff));
    }
    return {
      postures: eventsByCutoff.map((events) => rewindScopePosture(capabilityIds, declared, events)),
      current: rewindScopePosture(capabilityIds, declared, []),
      logStartsAt,
    };
  },

  /** The `logStartsAt` of `getScopePostureAt`, without rewinding any posture. */
  getScopePostureLogStart: async ({ repo, eventOrigin }, organizationId: string): Promise<Date | null> =>
    await repo.findFirstPostureEventAt(requireTenantId(eventOrigin), organizationId),

  /**
   * Every time a control's posture was logged as changing in `[from, to)`, at the scope's level or at
   * its tenant's, oldest first. A tenant line the scope's own declaration masks still counts.
   */
  getScopePostureMoves: async ({ repo, eventOrigin }, organizationId: string, from: Date, to: Date): Promise<Array<{ capabilityId: string, movedAt: Date }>> => {
    const events = await repo.findPostureEventsWithin(requireTenantId(eventOrigin), organizationId, from, to);
    return events.map((event) => ({ capabilityId: event.capabilityId, movedAt: event.createdAt }));
  },

  /** Answers what the overlay held before and after, which is what the caller books its recompute on. */
  declareScopePosture: async (
    { atomic, eventOrigin },
    organizationId: string,
    capabilityId: string,
    declaration: ScopePostureDeclaration,
  ): Promise<ScopePostureTransition> => {
    const tenantId = requireClientTenantId(eventOrigin);
    const userId = eventOrigin.type === 'client' ? eventOrigin.userId : null;
    return await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.validateCapabilityId(capabilityId);
      await atomicRepo.validateOrganizationId(organizationId);
      const before = await atomicRepo.findScopeOverride({ organizationId, capabilityId });
      await writeScopeOverride(atomicRepo, { organizationId, capabilityId }, tenantId, userId, before, declaration, declaration.comment);
      return { before, after: declaration };
    });
  },

  clearScopePostureDimension: async (
    { atomic, eventOrigin },
    organizationId: string,
    capabilityId: string,
    dimension: PostureDimension,
  ): Promise<ScopePostureTransition> => {
    const tenantId = requireClientTenantId(eventOrigin);
    const userId = eventOrigin.type === 'client' ? eventOrigin.userId : null;
    return await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.validateCapabilityId(capabilityId);
      await atomicRepo.validateOrganizationId(organizationId);
      const before = await atomicRepo.findScopeOverride({ organizationId, capabilityId });
      if (!before) {
        return { before: undefined, after: undefined };
      }
      const after = {
        strengthRung: dimension === 'strength' ? null : before.strengthRung,
        coverageBucket: dimension === 'coverage' ? null : before.coverageBucket,
        comment: before.comment,
      };
      await writeScopeOverride(atomicRepo, { organizationId, capabilityId }, tenantId, userId, before, after, null);
      return { before, after };
    });
  },

  getCapabilityEvents: async ({ repo, eventOrigin }, capabilityId: string, organizationId?: string | null) => {
    const tenantId = requireTenantId(eventOrigin);
    return withEventSources(repo, tenantId, await repo.findCapabilityEvents(capabilityId, tenantId, organizationId ?? undefined));
  },

  /**
   * The control's posture after each journal line that moved it, as the page would have shown it
   * that day: inside a scope, the scope's declarations merged with the tenant lines it inherits.
   * Ends on the live posture, so the last line always agrees with `getResolvedPosture`.
   */
  getEffectivenessHistory: async ({ repo, eventOrigin }, capabilityId: string, organizationId: string | null) => {
    const tenantId = requireTenantId(eventOrigin);
    if (organizationId !== null) {
      await repo.validateOrganizationId(organizationId);
    }
    const [events, tenant, override] = await Promise.all([
      repo.findCapabilityEvents(capabilityId, tenantId, organizationId ?? undefined),
      repo.findTenantPosture(capabilityId, tenantId),
      organizationId === null ? Promise.resolve(undefined) : repo.findScopeOverride({ organizationId, capabilityId }),
    ]);
    const scoped = organizationId !== null;
    const live = (scoped ? tenant !== undefined || override !== undefined : tenant !== undefined)
      ? resolveScopePosture(tenant, override)
      : null;
    return replayEffectivenessHistory(await withEventSources(repo, tenantId, events), live, scoped, new Date());
  },
});
