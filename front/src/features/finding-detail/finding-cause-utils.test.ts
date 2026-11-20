import { i18n } from '@lingui/core';
import type { EvidenceHistoryOrigin } from '@app/module/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { describeHistoryRow } from '../supporting-assets/components/finding-history';
import { causeFacts, dismissalCause } from './finding-cause-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('causeFacts', () => {
  it.each<[EvidenceHistoryOrigin, string]>([
    ['exposed', 'sync test'],
    ['not_exposed', 'sync test'],
    ['no_longer_reported', 'sync retirement'],
    ['user', 'decision'],
    ['reset', 'handover'],
  ])('reads %s as a %s', (origin, expected) => {
    const facts = causeFacts(origin);
    const read = [
      facts.bySync && 'sync',
      facts.byTest && 'test',
      facts.retirement && 'retirement',
      facts.decision && 'decision',
      facts.handover && 'handover',
    ].filter(Boolean).join(' ');

    expect(read).toBe(expected);
  });
});

describe('dismissalCause', () => {
  it('reads a CVE a test held as no longer reported, a technique as not exposed, and no history as set aside', () => {
    expect(dismissalCause('cve', 'not_exposed')).toBe('no_longer_reported');
    expect(dismissalCause('technique', 'not_exposed')).toBe('not_exposed');
    expect(dismissalCause('technique', 'no_longer_reported')).toBe('no_longer_reported');
    expect(dismissalCause('technique', 'reset')).toBe('set_aside');
    expect(dismissalCause('cve', null)).toBe('set_aside');
  });
});

describe('describeHistoryRow: actor', () => {
  const row = { id: 'h', stateChangedAt: '2026-06-01T00:00:00Z', state: 'dismissed', reason: null, changedByUserId: null };
  const actorOf = (origin: EvidenceHistoryOrigin, changedByUserName: string | null) =>
    describeHistoryRow({ ...row, origin, changedByUserName }, null, { kind: 'cve', connectorName: 'Microsoft Defender' }).actor;

  it('credits a sync row to the connector, whatever author it carries', () => {
    expect(actorOf('no_longer_reported', 'Alice')).toBe('Microsoft Defender');
  });

  it('credits a person\'s row to them, or to a deleted user once their account is gone', () => {
    expect(actorOf('user', 'Alice')).toBe('Alice');
    expect(actorOf('user', null)).toBe('Deleted user');
  });

  it('credits a handover with no recorded initiator to an unknown user', () => {
    expect(actorOf('reset', null)).toBe('Unknown user');
  });
});
