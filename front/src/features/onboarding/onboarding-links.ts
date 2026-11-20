import { linkOptions } from '@tanstack/react-router';
import type { OnboardingStepKey } from './onboarding-steps';
import { nextStepKey } from './onboarding-utils';

const GET_STARTED = '/$tenantId/{-$organizationId}/get-started';

const GET_STARTED_OVERVIEW_LINK = linkOptions({ from: GET_STARTED, to: '.' });

export const GET_STARTED_DONE_LINK = linkOptions({ from: GET_STARTED, to: 'done' });

/** One entry per step flagged `available`, next to its route file: `from` is the base, so the link resolves the same wherever it is rendered. */
const STEP_LINKS = {
  company: linkOptions({ from: GET_STARTED, to: 'company' }),
  assets: linkOptions({ from: GET_STARTED, to: 'assets' }),
  threats: linkOptions({ from: GET_STARTED, to: 'threats' }),
  defenses: linkOptions({ from: GET_STARTED, to: 'defenses' }),
  finances: linkOptions({ from: GET_STARTED, to: 'finances' }),
  tolerance: linkOptions({ from: GET_STARTED, to: 'tolerance' }),
  protect: linkOptions({ from: GET_STARTED, to: 'protect' }),
  scenarios: linkOptions({ from: GET_STARTED, to: 'scenarios' }),
} satisfies Partial<Record<OnboardingStepKey, unknown>>;

type LinkedStepKey = keyof typeof STEP_LINKS;

const isLinkedStepKey = (key: OnboardingStepKey): key is LinkedStepKey => key in STEP_LINKS;

/** Whether `getStepLink` leads to the step's own page rather than to the overview. */
export const hasStepPage = (key: OnboardingStepKey): boolean => isLinkedStepKey(key);

/** The page of a step, or the overview for `null` (no next or previous step) and for a step with no page. */
export const getStepLink = (key: OnboardingStepKey | null) => {
  if (key === null || !isLinkedStepKey(key)) {
    return GET_STARTED_OVERVIEW_LINK;
  }
  return STEP_LINKS[key];
};

/** Where Next leads: the following step, or past the last one the finish screen once the wizard is finished, else the overview. */
export const getNextLink = (key: OnboardingStepKey, finished: boolean) => {
  const next = nextStepKey(key);
  return next === null && finished ? GET_STARTED_DONE_LINK : getStepLink(next);
};
