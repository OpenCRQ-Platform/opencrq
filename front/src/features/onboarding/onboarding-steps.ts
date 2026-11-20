import { t } from '@lingui/core/macro';

export type OnboardingStepKey = 'company' | 'assets' | 'threats' | 'defenses' | 'finances' | 'tolerance' | 'protect' | 'scenarios';

export interface OnboardingStep {
  key: OnboardingStepKey,
  label: () => string,
  /** False while the step is not built: it shows as coming soon and cannot be opened. */
  available: boolean,
}

export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  { key: 'company', label: () => t`Company`, available: true },
  { key: 'assets', label: () => t`Assets`, available: true },
  { key: 'threats', label: () => t`Threats`, available: true },
  { key: 'defenses', label: () => t`Defenses`, available: true },
  { key: 'finances', label: () => t`Finances`, available: true },
  { key: 'tolerance', label: () => t`Tolerance`, available: true },
  { key: 'protect', label: () => t`Protect`, available: true },
  { key: 'scenarios', label: () => t`Scenarios`, available: true },
];
