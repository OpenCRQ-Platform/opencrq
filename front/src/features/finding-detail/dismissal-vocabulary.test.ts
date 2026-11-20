import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FindingHistoryEntry } from '../supporting-assets/components/finding-history';
import type { FlawKind } from './dismissal-vocabulary';
import { describeHistoryRow } from '../supporting-assets/components/finding-history';
import { stateDurationLabel } from '../finding-score/ui/red-duration';
import { dismissedStateFilterLabel, dismissedStateLabel } from './dismissal-vocabulary';

const getHistoryTitle = (entry: FindingHistoryEntry, previousEntry: FindingHistoryEntry | null, kind: FlawKind) =>
  describeHistoryRow(entry, previousEntry, { kind, connectorName: 'OpenAEV' }).title;
const getHistoryTestedAt = (entry: FindingHistoryEntry) => describeHistoryRow(entry, null, { kind: 'technique', connectorName: 'OpenAEV' }).testedAt;

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('dismissedStateLabel', () => {
  it('reads a finding no source reports any more as no longer reported, on either kind of finding', () => {
    expect(dismissedStateLabel({ kind: 'cve', origin: 'no_longer_reported', dismissalType: null })).toBe('No longer reported');
    expect(dismissedStateLabel({ kind: 'technique', origin: 'no_longer_reported', dismissalType: null })).toBe('No longer reported');
  });

  it('reads a technique test that held as not exposed, and a CVE as no longer reported', () => {
    expect(dismissedStateLabel({ kind: 'technique', origin: 'not_exposed', dismissalType: null })).toBe('Not exposed');
    expect(dismissedStateLabel({ kind: 'cve', origin: 'not_exposed', dismissalType: null })).toBe('No longer reported');
  });

  it('keeps a person\'s decision set aside, by the type it was filed under', () => {
    expect(dismissedStateLabel({ kind: 'cve', origin: 'user', dismissalType: 'risk_accepted' })).toBe('Risk accepted');
    expect(dismissedStateLabel({ kind: 'cve', origin: 'user', dismissalType: null })).toBe('Set aside');
  });

  it('reads a decision handed back to the connector as the person\'s until a sync rewrites it', () => {
    expect(dismissedStateLabel({ kind: 'cve', origin: 'reset', dismissalType: null })).toBe('Set aside');
  });
});

describe('dismissedStateFilterLabel', () => {
  it('names every cause a technique list can hold, a retirement included', () => {
    expect(dismissedStateFilterLabel('cve')).toBe('Set aside or no longer reported');
    expect(dismissedStateFilterLabel('technique')).toBe('Set aside, no longer reported or not exposed');
  });
});

describe('describeHistoryRow: title', () => {
  const row = { id: 'h', stateChangedAt: '2026-06-01T00:00:00Z', reason: null, changedByUserId: null, changedByUserName: null };
  const exposed = { ...row, id: 'h0', state: 'applicable', origin: 'exposed' as const };

  it('words a technique test that held as not exposed', () => {
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'not_exposed' }, exposed, 'technique')).toBe('State changed to not exposed.');
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'not_exposed' }, null, 'technique')).toBe('Finding reported as not exposed.');
  });

  it('words a finding no connector reports any more apart from one whose test held', () => {
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'no_longer_reported' }, exposed, 'technique')).toBe('No longer reported by any connector.');
  });

  it('words a sync confirming the state a person handed back as a confirmation, not as a change', () => {
    const resetTo = (state: string) => ({ ...row, id: 'h1', state, origin: 'reset' as const });

    expect(getHistoryTitle({ ...row, state: 'applicable', origin: 'exposed' }, resetTo('applicable'), 'technique')).toBe('Connector confirmed the state (applicable).');
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'not_exposed' }, resetTo('dismissed'), 'technique')).toBe('Connector confirmed the state (not exposed).');
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'not_exposed' }, resetTo('dismissed'), 'cve')).toBe('Connector confirmed the state (no longer reported).');
  });

  it('words a technique tested again after its retirement as a change of cause, a CVE reported again as a confirmation', () => {
    const retired = { ...row, id: 'h1', state: 'dismissed', origin: 'no_longer_reported' as const };

    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'not_exposed' }, retired, 'technique')).toBe('State changed to not exposed.');
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'not_exposed' }, retired, 'cve')).toBe('Connector confirmed the state (no longer reported).');
    expect(getHistoryTitle({ ...row, state: 'applicable', origin: 'exposed' }, retired, 'technique')).toBe('State changed to applicable.');
  });

  it('words a retirement after a handover as no longer reported, since no connector confirmed anything', () => {
    const resetTo = { ...row, id: 'h1', state: 'dismissed', origin: 'reset' as const };

    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'no_longer_reported' }, resetTo, 'cve')).toBe('No longer reported by any connector.');
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'no_longer_reported' }, resetTo, 'technique')).toBe('No longer reported by any connector.');
  });

  it('words a person\'s rows as theirs, the first one and the later ones', () => {
    expect(getHistoryTitle({ ...row, state: 'applicable', origin: 'user' }, null, 'cve')).toBe('Finding marked as applicable by user.');
    expect(getHistoryTitle({ ...row, state: 'applicable', origin: 'user' }, { ...exposed, state: 'dismissed', origin: 'not_exposed' }, 'cve')).toBe('State changed to applicable by user.');
    expect(getHistoryTitle({ ...row, state: 'dismissed', origin: 'user', dismissalType: 'risk_accepted', dismissalReasonCode: 'wont_fix' }, exposed, 'cve')).toBe('Set aside as Risk accepted: Won\'t fix.');
  });
});

describe('describeHistoryRow: test date', () => {
  const row = { id: 'h', state: 'applicable', reason: null, changedByUserId: null, changedByUserName: null, origin: 'exposed' as const };

  it('dates a result delivered on a later day by its test', () => {
    expect(getHistoryTestedAt({ ...row, stateChangedAt: '2026-06-03T10:00:00Z', observedAt: '2026-06-01T10:00:00Z' })).toEqual(new Date('2026-06-01T10:00:00Z'));
  });

  it('adds nothing to a row learned the day its test ran, nor to one no test caused', () => {
    expect(getHistoryTestedAt({ ...row, stateChangedAt: '2026-06-01T12:00:00Z', observedAt: '2026-06-01T10:00:00Z' })).toBeNull();
    expect(getHistoryTestedAt({ ...row, origin: 'user', stateChangedAt: '2026-06-03T10:00:00Z', observedAt: null })).toBeNull();
    expect(getHistoryTestedAt({ ...row, state: 'dismissed', origin: 'no_longer_reported', stateChangedAt: '2026-06-03T10:00:00Z', observedAt: '2026-06-01T10:00:00Z' })).toBeNull();
  });
});

describe('stateDurationLabel', () => {
  const now = new Date('2026-06-04T00:00:00Z');

  it('dates a sync dismissal in the words of its cause', () => {
    const at = '2026-06-01T00:00:00Z';

    expect(stateDurationLabel('dismissed', at, { kind: 'cve', latest: { origin: 'no_longer_reported', enteredAt: at } }, now)).toBe('Not reported for 3 days');
    expect(stateDurationLabel('dismissed', at, { kind: 'technique', latest: { origin: 'no_longer_reported', enteredAt: at } }, now)).toBe('Not reported for 3 days');
    expect(stateDurationLabel('dismissed', at, { kind: 'technique', latest: { origin: 'not_exposed', enteredAt: at } }, now)).toBe('Not exposed for 3 days');
    expect(stateDurationLabel('dismissed', at, { kind: 'cve', latest: { origin: 'user', enteredAt: at } }, now)).toBe('Set aside 3 days ago');
  });

  it('dates a sync confirming a handed-back dismissal from its own row, not from the person\'s', () => {
    expect(stateDurationLabel('dismissed', '2026-05-05T00:00:00Z', { kind: 'cve', latest: { origin: 'no_longer_reported', enteredAt: '2026-06-03T00:00:00Z' } }, now)).toBe('Not reported for 1 day');
  });

  it('dates a handed-back dismissal no connector confirmed yet from the person\'s', () => {
    expect(stateDurationLabel('dismissed', '2026-05-05T00:00:00Z', { kind: 'cve', latest: { origin: 'reset', enteredAt: '2026-06-03T00:00:00Z' } }, now)).toBe('Set aside 30 days ago');
  });
});
