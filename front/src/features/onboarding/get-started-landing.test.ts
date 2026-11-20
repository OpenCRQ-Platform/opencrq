import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingWizard } from './onboarding-utils';
import { markGetStartedSeen, onboardingSeenCollection } from '../../stores/onboarding-seen-collection';
import { opensGetStarted } from './get-started-landing';

const wizard = (finished: boolean): OnboardingWizard => ({
  id: 'wizard-id',
  organizationId: 'scope-id',
  steps: {
    company: 'done', assets: 'done', threats: 'done', defenses: 'done', finances: 'done', tolerance: 'done', protect: 'done', scenarios: finished ? 'done' : 'todo',
  },
  finished,
});

describe('opensGetStarted', () => {
  afterEach(() => {
    const keys = Array.from(onboardingSeenCollection.keys());
    if (keys.length > 0) {
      onboardingSeenCollection.delete(keys);
    }
  });

  it('opens Get started for an unfinished wizard the reader has not seen yet', async () => {
    await expect(opensGetStarted({ userId: 'user-a', tenantId: 'tenant-a', readWizard: () => Promise.resolve(wizard(false)) })).resolves.toBe(true);
  });

  it('reads nothing once this browser has seen Get started for that user and tenant', async () => {
    markGetStartedSeen('user-b', 'tenant-b');
    const readWizard = vi.fn(() => Promise.resolve(wizard(false)));

    await expect(opensGetStarted({ userId: 'user-b', tenantId: 'tenant-b', readWizard })).resolves.toBe(false);
    expect(readWizard).not.toHaveBeenCalled();
  });

  it('lets the home render when the read fails, when there is no wizard, or once it is finished', async () => {
    await expect(opensGetStarted({ userId: 'user-c', tenantId: 'tenant-c', readWizard: () => Promise.reject(new Error('down')) })).resolves.toBe(false);
    await expect(opensGetStarted({ userId: 'user-c', tenantId: 'tenant-c', readWizard: () => Promise.resolve(null) })).resolves.toBe(false);
    await expect(opensGetStarted({ userId: 'user-c', tenantId: 'tenant-c', readWizard: () => Promise.resolve(wizard(true)) })).resolves.toBe(false);
  });
});
