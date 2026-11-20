import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyRegistrationStatus,
  getLastRegistrationAttempt,
  getXtmOneFailingSince,
  getXtmOneLastAnswerAt,
  getXtmOneReachability,
  recordRegistrationFailure,
  recordRegistrationSuccess,
  resetXtmOneReachability,
  XTM_ONE_REACHABILITY_GRACE_MS,
} from './xtm-one-reachability';

const T0 = 1_700_000_000_000;

describe('XTM One reachability', () => {
  beforeEach(() => {
    resetXtmOneReachability();
  });

  it('is pending before any registration attempt', () => {
    expect(getXtmOneReachability(T0)).toBe('pending');
  });

  it('is ok right after a success', () => {
    recordRegistrationSuccess(T0);
    expect(getXtmOneReachability(T0)).toBe('ok');
  });

  it.each(['refused', 'unreachable', 'unreadable'] as const)('reports a first failure (%s) immediately when no success ever landed', (cause) => {
    recordRegistrationFailure(cause);
    expect(getXtmOneReachability(T0)).toBe(cause);
  });

  it('stays ok through a failure that follows a recent success, so a single lost heartbeat does not flap the banner', () => {
    recordRegistrationSuccess(T0);
    recordRegistrationFailure('unreachable');
    expect(getXtmOneReachability(T0 + 60_000)).toBe('ok');
  });

  it('stays ok up to the reachability grace period after the last success, then reports the failure cause', () => {
    recordRegistrationSuccess(T0);
    recordRegistrationFailure('refused');
    expect(getXtmOneReachability(T0 + XTM_ONE_REACHABILITY_GRACE_MS - 1)).toBe('ok');
    expect(getXtmOneReachability(T0 + XTM_ONE_REACHABILITY_GRACE_MS)).toBe('refused');
  });

  it('recovers to ok immediately once a success follows failures', () => {
    recordRegistrationFailure('unreachable');
    recordRegistrationSuccess(T0 + 1_000);
    expect(getXtmOneReachability(T0 + 1_000)).toBe('ok');
  });

  it('keeps the latest failure cause when it differs from the previous one', () => {
    recordRegistrationFailure('refused');
    recordRegistrationFailure('unreachable');
    expect(getXtmOneReachability(T0 + 1_000)).toBe('unreachable');
  });

  it('stays ok once a success ages past the grace with no failure recorded since', () => {
    recordRegistrationSuccess(T0);
    expect(getXtmOneReachability(T0 + XTM_ONE_REACHABILITY_GRACE_MS)).toBe('ok');
  });

  describe('since when it fails', () => {
    it('has no start before any failure, nor while the grace still reports ok', () => {
      expect(getXtmOneFailingSince(T0)).toBeNull();
      recordRegistrationSuccess(T0);
      recordRegistrationFailure('unreachable', T0 + 1);
      expect(getXtmOneFailingSince(T0 + 2)).toBeNull();
    });

    it('dates a failure from its first attempt, not the latest', () => {
      recordRegistrationFailure('unreachable', T0);
      recordRegistrationFailure('unreachable', T0 + 5_000);
      expect(getXtmOneFailingSince(T0 + 10_000)).toBe(T0);
    });

    it('dates an unreadable answer from its first attempt', () => {
      recordRegistrationFailure('unreadable', T0);
      recordRegistrationFailure('unreadable', T0 + 5_000);
      expect(getXtmOneFailingSince(T0 + 10_000)).toBe(T0);
    });

    it('dates a change of cause from the new cause', () => {
      recordRegistrationFailure('unreachable', T0);
      recordRegistrationFailure('refused', T0 + 5_000);
      expect(getXtmOneFailingSince(T0 + 10_000)).toBe(T0 + 5_000);
    });

    it('dates a switch from unreachable to unreadable from the new cause', () => {
      recordRegistrationFailure('unreachable', T0);
      recordRegistrationFailure('unreadable', T0 + 5_000);
      expect(getXtmOneFailingSince(T0 + 10_000)).toBe(T0 + 5_000);
    });

    it('has no start when a success ages with no failure recorded since', () => {
      recordRegistrationSuccess(T0);
      expect(getXtmOneFailingSince(T0 + XTM_ONE_REACHABILITY_GRACE_MS)).toBeNull();
    });

    it('forgets the start once a registration succeeds again', () => {
      recordRegistrationFailure('refused', T0);
      recordRegistrationSuccess(T0 + 1_000);
      recordRegistrationFailure('refused', T0 + 2_000);
      expect(getXtmOneFailingSince(T0 + 1_000 + XTM_ONE_REACHABILITY_GRACE_MS)).toBe(T0 + 2_000);
    });
  });

  describe('getLastRegistrationAttempt', () => {
    it('is null before any attempt', () => {
      expect(getLastRegistrationAttempt()).toBeNull();
    });

    it('reports a failure inside the grace, which the reachability hides', () => {
      recordRegistrationSuccess(T0);
      recordRegistrationFailure('refused', T0 + 1_000);
      expect(getXtmOneReachability(T0 + 1_000)).toBe('ok');
      expect(getLastRegistrationAttempt()).toEqual({ sequence: 2, outcome: 'refused', failingSince: T0 + 1_000 });
    });

    it('keeps the first attempt of a repeated cause as its start', () => {
      recordRegistrationFailure('unreachable', T0);
      recordRegistrationFailure('unreachable', T0 + 1_000);
      expect(getLastRegistrationAttempt()).toEqual({ sequence: 2, outcome: 'unreachable', failingSince: T0 });
    });

    it('reports a success with no failure start', () => {
      recordRegistrationFailure('unreachable', T0);
      recordRegistrationSuccess(T0 + 1_000);
      expect(getLastRegistrationAttempt()).toEqual({ sequence: 2, outcome: 'ok', failingSince: null });
    });
  });

  describe('getXtmOneLastAnswerAt', () => {
    it('is null before any answer', () => {
      recordRegistrationFailure('unreachable', T0);
      expect(getXtmOneLastAnswerAt()).toBeNull();
    });

    it('keeps the last success through later failures', () => {
      recordRegistrationSuccess(T0);
      recordRegistrationFailure('refused', T0 + 1_000);
      expect(getXtmOneLastAnswerAt()).toBe(T0);
    });
  });

  describe('classifyRegistrationStatus', () => {
    it.each([401, 403])('classifies %i as refused', (status) => {
      expect(classifyRegistrationStatus(status)).toBe('refused');
    });

    it.each([404, 500, 502])('classifies %i as unreachable', (status) => {
      expect(classifyRegistrationStatus(status)).toBe('unreachable');
    });
  });
});
