import { describe, expect, it } from 'vitest';
import { shownXtmOneRegistration } from './xtm-one-check-utils';

const ANSWERED = new Date('2026-11-06T09:00:00Z');
const FAILED = new Date('2026-11-06T09:02:00Z');

describe('shownXtmOneRegistration', () => {
  it('reports the reachability when nothing was checked', () => {
    expect(shownXtmOneRegistration({ registration: 'ok', failingSince: null, lastAnsweredAt: ANSWERED }, null))
      .toEqual({ registration: 'ok', failingSince: null });
  });

  it('shows a refused check over the ok the grace still reports', () => {
    expect(shownXtmOneRegistration(
      { registration: 'ok', failingSince: null, lastAnsweredAt: ANSWERED },
      { registration: 'refused', failingSince: FAILED, lastAnsweredAt: ANSWERED },
    )).toEqual({ registration: 'refused', failingSince: FAILED });
  });

  it('shows a check that failed before XTM One ever answered', () => {
    expect(shownXtmOneRegistration(
      { registration: 'pending', failingSince: null, lastAnsweredAt: null },
      { registration: 'unreachable', failingSince: FAILED, lastAnsweredAt: null },
    )).toEqual({ registration: 'unreachable', failingSince: FAILED });
  });

  it('drops a failed check once XTM One answered again', () => {
    expect(shownXtmOneRegistration(
      { registration: 'ok', failingSince: null, lastAnsweredAt: new Date('2026-11-06T09:05:00Z') },
      { registration: 'unreachable', failingSince: FAILED, lastAnsweredAt: ANSWERED },
    )).toEqual({ registration: 'ok', failingSince: null });
  });

  it('reports the reachability after a successful check', () => {
    expect(shownXtmOneRegistration(
      { registration: 'ok', failingSince: null, lastAnsweredAt: ANSWERED },
      { registration: 'ok', failingSince: null, lastAnsweredAt: ANSWERED },
    )).toEqual({ registration: 'ok', failingSince: null });
  });
});
