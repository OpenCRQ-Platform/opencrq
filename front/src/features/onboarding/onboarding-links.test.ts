import { describe, expect, it } from 'vitest';
import { GET_STARTED_DONE_LINK, getNextLink, getStepLink, hasStepPage } from './onboarding-links';
import { ONBOARDING_STEPS } from './onboarding-steps';

describe('hasStepPage', () => {
  it.each(ONBOARDING_STEPS.filter((step) => step.available).map((step) => step.key))(
    'leads %s, flagged available, to a page of its own and not to the overview',
    (key) => {
      expect(hasStepPage(key)).toBe(true);
    },
  );

  it('has no page for a step flagged unavailable', () => {
    expect(ONBOARDING_STEPS.filter((step) => !step.available).every((step) => !hasStepPage(step.key))).toBe(true);
  });
});

describe('getNextLink', () => {
  it('leads a step to the one after it, finished or not', () => {
    expect(getNextLink('company', true)).toEqual(getStepLink('assets'));
    expect(getNextLink('protect', false)).toEqual(getStepLink('scenarios'));
  });

  it('leads past the last step to the overview while the wizard is not finished', () => {
    expect(getNextLink('scenarios', false)).toEqual(getStepLink(null));
  });

  it('leads past the last step to the finish screen once the wizard is finished', () => {
    expect(getNextLink('scenarios', true)).toEqual(GET_STARTED_DONE_LINK);
  });
});
