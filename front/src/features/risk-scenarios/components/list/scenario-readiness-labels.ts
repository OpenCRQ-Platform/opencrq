import type { ScenarioInputKind, ScenarioReadinessStatus } from '@app/module/client';
import { t } from '@lingui/core/macro';

export const getScenarioReadinessLabel = (status: ScenarioReadinessStatus): string => ({
  'no-mapped-asset': t`No mapped asset`,
  ready: t`Ready`,
  stale: t`Stale`,
  incomplete: t`Incomplete`,
  'not-simulated': t`Not simulated`,
}[status]);

export const getScenarioReadinessExplanation = (status: ScenarioReadinessStatus): string => ({
  'no-mapped-asset': t`This scope is measured over its mapped assets and holds none, so no simulation can run.`,
  ready: t`Every input is filled in and reflected by the latest simulation.`,
  stale: t`These inputs changed after the latest simulation:`,
  incomplete: t`These inputs have never been filled in:`,
  'not-simulated': t`This scenario has never been simulated.`,
}[status]);

export const getScenarioInputLabel = (kind: ScenarioInputKind): string => ({
  tef: t`Threat Event Frequency`,
  'loss-drivers': t`Financial Impact`,
}[kind]);
