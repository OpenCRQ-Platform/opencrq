import { t } from '@lingui/core/macro';
import { ASSESSMENT_AXES, DERIVATION_WRITER, DRATA_SOURCE } from '@app/module/client';
import type { AssessmentAxis, CoverageBucket, StrengthRung } from '@app/module/client';
import type { CapabilityAssessedBy, CapabilityAssessment, CapabilityAssessmentSource, CapabilityDetail, CapabilityEventSource } from '../types/capability';
import { formatConnectorName } from './connector-name';

export const derivedAxesOf = (assessment: CapabilityAssessment | null): Array<AssessmentAxis> =>
  (assessment === null
    ? []
    : ASSESSMENT_AXES.filter((axis) => (axis === 'strength' ? assessment.strengthMode : assessment.coverageMode) === 'auto'));

/** A derived axis always lists a source, until the derivation clears it for want of any. */
export const isUnfed = (
  assessment: CapabilityAssessment,
  sources: ReadonlyArray<Pick<CapabilityAssessmentSource, 'axis'>>,
  axis: AssessmentAxis,
): boolean => derivedAxesOf(assessment).includes(axis) && !sources.some((source) => source.axis === axis);

interface PooledCoverage {
  coverageBucket: CoverageBucket,
  coverageBasis: string,
  assumedFromLevel: number | null,
}

/**
 * The level an assumed coverage was read from, taken from the live pooling: it is null while that
 * pooling and the stored bucket disagree, as they do between a publication and the derivation run
 * it enqueues.
 */
export const assumedLevelOf = (pooled: PooledCoverage | null | undefined, storedBucket: CoverageBucket): number | null =>
  (pooled?.coverageBasis === 'assumed' && pooled.coverageBucket === storedBucket ? pooled.assumedFromLevel : null);

/** Each source once, Drata first, a framework under its title. */
export const assessmentSourceNames = (sources: ReadonlyArray<CapabilityAssessmentSource>): Array<string> => {
  const names = new Map<string, string>();
  const ordered = sources.toSorted((a, b) => Number(b.source === DRATA_SOURCE) - Number(a.source === DRATA_SOURCE) || a.source.localeCompare(b.source));
  for (const { source, frameworkTitle } of ordered) {
    if (!names.has(source)) {
      names.set(source, frameworkTitle ?? formatConnectorName(source));
    }
  }
  return [...names.values()];
};

const eventSourceName = (source: CapabilityEventSource): string => {
  if (source.source === DRATA_SOURCE) {
    return formatConnectorName(source.source);
  }
  const frameworkTitle = source.frameworkTitle ?? formatConnectorName(source.source);
  const assessmentName = source.complianceAssessmentName;
  return assessmentName === null
    ? frameworkTitle
    : t({ context: 'assessment source', message: `${frameworkTitle} · ${assessmentName}` });
};

/**
 * Drata first, then one name per assessment of each framework, keyed by the assessment's id since
 * two assessments of a framework may share a name. An axis without sources is left out.
 */
export const eventSourceNamesByAxis = (
  sources: ReadonlyArray<CapabilityEventSource>,
): Array<{ axis: AssessmentAxis, names: Array<string> }> =>
  ASSESSMENT_AXES.flatMap((axis) => {
    const ordered = sources
      .filter((source) => source.axis === axis)
      .toSorted((a, b) => Number(b.source === DRATA_SOURCE) - Number(a.source === DRATA_SOURCE)
        || a.source.localeCompare(b.source)
        || (a.complianceAssessmentName ?? '').localeCompare(b.complianceAssessmentName ?? '')
        || (a.complianceAssessmentId ?? '').localeCompare(b.complianceAssessmentId ?? ''));
    const unique = new Map(ordered.map((source) => [`${source.source}:${source.complianceAssessmentId ?? ''}`, source]));
    const names = [...unique.values()].map(eventSourceName);
    return names.length === 0 ? [] : [{ axis, names }];
  });

export interface AssessmentProvenance {
  at: string | Date | null,
  by: CapabilityAssessedBy | null,
  /** Null for a value a user declared; empty for a derived one whose sources are no longer known. */
  derivedFrom: Array<string> | null,
}

/** A writer the event history names, read as the sources it stands for: the derivation stands for the value's own. */
export const writerProvenance = (connector: string | null, sourceNames: Array<string>): Array<string> | null => {
  if (connector === null) {
    return null;
  }
  return connector === DERIVATION_WRITER ? sourceNames : [formatConnectorName(connector)];
};

/**
 * While any axis is still derived, the line names every source of the value at the latest derived
 * write, even when a user declared another axis since. Otherwise it names the latest writer.
 */
export const tenantAssessmentProvenance = (capability: CapabilityDetail): AssessmentProvenance => {
  const names = assessmentSourceNames(capability.assessmentSources);
  if (derivedAxesOf(capability.assessment).length > 0 && names.length > 0 && capability.lastDerivedAt !== null) {
    return { at: capability.lastDerivedAt, by: capability.lastDerivedBy, derivedFrom: names };
  }
  return { at: capability.lastAssessedAt, by: capability.lastAssessedBy, derivedFrom: writerProvenance(capability.lastAssessedConnector, names) };
};

export interface AxisState<T extends string> {
  value: T | null,
  /** Handed to the derivation rather than declared. */
  attached: boolean,
}

export interface AssessmentSavePlan {
  /** Null when no axis is declared; inside, a null axis is left as it is. */
  declare: { strengthRung: StrengthRung | null, coverageBucket: CoverageBucket | null } | null,
  reattach: Array<AssessmentAxis>,
}

export interface AssessmentAxesState {
  strength: AxisState<StrengthRung>,
  coverage: AxisState<CoverageBucket>,
}

const isDeclared = <T extends string>(initial: AxisState<T>, current: AxisState<T>): boolean =>
  !current.attached && current.value !== null && (initial.attached || current.value !== initial.value);

/** Picking a value on a derived axis declares it; re-attaching a declared one hands it back. */
export const planAssessmentSave = (initial: AssessmentAxesState, current: AssessmentAxesState): AssessmentSavePlan => {
  const declareStrength = isDeclared(initial.strength, current.strength);
  const declareCoverage = isDeclared(initial.coverage, current.coverage);
  return {
    declare: declareStrength || declareCoverage
      ? {
        strengthRung: declareStrength ? current.strength.value : null,
        coverageBucket: declareCoverage ? current.coverage.value : null,
      }
      : null,
    reattach: ASSESSMENT_AXES.filter((axis) => current[axis].attached && !initial[axis].attached),
  };
};

export const hasSaveWork = (plan: AssessmentSavePlan): boolean => plan.declare !== null || plan.reattach.length > 0;

export interface ModeSwitch {
  axis: AssessmentAxis,
  toAuto: boolean,
}

export const modeSwitchesOf = (initial: AssessmentAxesState, current: AssessmentAxesState): Array<ModeSwitch> =>
  ASSESSMENT_AXES.filter((axis) => initial[axis].attached !== current[axis].attached).map((axis) => ({ axis, toAuto: current[axis].attached }));

/** A manual axis holds a value to declare. */
export const isSaveComplete = (current: AssessmentAxesState): boolean =>
  ASSESSMENT_AXES.every((axis) => current[axis].attached || current[axis].value !== null);

/** Built from two patterns rather than a list format, since French repeats the preposition: "de Drata et de NIST CSF 2.0". */
export const joinSourceNames = (names: ReadonlyArray<string>): string => {
  let joined = names.at(-1) ?? '';
  for (let index = names.length - 2; index >= 0; index -= 1) {
    const head = names[index] ?? '';
    const rest = joined;
    joined = index === names.length - 2
      ? t({ context: 'assessment sources', message: `${head} and ${rest}` })
      : t({ context: 'assessment sources', message: `${head}, ${rest}` });
  }
  return joined;
};
