import { describe, expect, it } from 'vitest';
import {
  chunkIds,
  groupReferenceIdsByKind,
  parseRunReferences,
  resolveRunReference,
  triggeredByReference,
} from './run-references-utils';

describe('parseRunReferences', () => {
  it('reads a risk scenario id off its payload key', () => {
    const payload = '{"riskScenarioId":"b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f"}';
    expect(parseRunReferences(payload)).toEqual([{ kind: 'riskScenario', id: 'b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f' }]);
  });

  it('reads several keys off the same payload, in key order', () => {
    const payload = '{"riskScenarioId":"scenario-1","userId":"user-1"}';
    expect(parseRunReferences(payload)).toEqual([
      { kind: 'riskScenario', id: 'scenario-1' },
      { kind: 'user', id: 'user-1' },
    ]);
  });

  it('reads a service account id', () => {
    expect(parseRunReferences('{"serviceAccountId":"sa-1"}')).toEqual([{ kind: 'serviceAccount', id: 'sa-1' }]);
  });

  it('reads a stored file id', () => {
    expect(parseRunReferences('{"storedFileId":"file-1"}')).toEqual([{ kind: 'storedFile', id: 'file-1' }]);
  });

  it('ignores a key absent from the fixed set', () => {
    expect(parseRunReferences('{"backfillOnly":true}')).toEqual([]);
  });

  it('renders no reference for a null payload', () => {
    expect(parseRunReferences(null)).toEqual([]);
  });

  it('renders no reference for an undefined payload', () => {
    expect(parseRunReferences(undefined)).toEqual([]);
  });

  it('renders no reference for invalid JSON', () => {
    expect(parseRunReferences('not json')).toEqual([]);
  });

  it('renders no reference for a payload truncated below the key', () => {
    expect(parseRunReferences('{"riskScenarioId":"b4d5e6f7…')).toEqual([]);
  });

  it('renders no reference when the known key is not a string', () => {
    expect(parseRunReferences('{"riskScenarioId":null}')).toEqual([]);
  });

  it('renders no reference for a JSON array payload', () => {
    expect(parseRunReferences('["riskScenarioId"]')).toEqual([]);
  });
});

describe('groupReferenceIdsByKind', () => {
  it('deduplicates and sorts ids within a kind, across several runs', () => {
    const runs = [
      { payload: '{"riskScenarioId":"scenario-b"}' },
      { payload: '{"riskScenarioId":"scenario-a"}' },
      { payload: '{"riskScenarioId":"scenario-b"}' },
    ];
    expect(groupReferenceIdsByKind(runs).riskScenario).toEqual(['scenario-a', 'scenario-b']);
  });

  it('keeps every kind present even when empty', () => {
    const grouped = groupReferenceIdsByKind([{ payload: null }]);
    expect(grouped).toEqual({ riskScenario: [], serviceAccount: [], user: [], storedFile: [] });
  });

  it('folds in extra references alongside the runs', () => {
    const grouped = groupReferenceIdsByKind([{ payload: null }], [{ kind: 'user', id: 'user-9' }]);
    expect(grouped.user).toEqual(['user-9']);
  });
});

describe('chunkIds', () => {
  it('splits ids into chunks no larger than the given size', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('returns no chunk for an empty list', () => {
    expect(chunkIds([], 200)).toEqual([]);
  });

  it('returns a single chunk when the list fits', () => {
    expect(chunkIds(['a', 'b'], 200)).toEqual([['a', 'b']]);
  });
});

describe('resolveRunReference', () => {
  const reference = { kind: 'riskScenario' as const, id: 'b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f' };

  it('resolves to the fetched name when the name is known', () => {
    const names = new Map([[reference.id, 'Ransomware on the billing system']]);
    expect(resolveRunReference(reference, names)).toEqual({ ...reference, label: 'Ransomware on the billing system' });
  });

  it('falls back to the id\'s first 8 characters when the name is missing', () => {
    expect(resolveRunReference(reference, new Map())).toMatchObject({ label: 'b4d5e6f7' });
  });

  it('marks the name hidden only once the lookup has settled without it', () => {
    expect(resolveRunReference(reference, new Map(), false)).toMatchObject({ nameHidden: false });
    expect(resolveRunReference(reference, new Map(), true)).toMatchObject({ nameHidden: true });
    expect(resolveRunReference(reference, new Map([[reference.id, 'Ransomware']]), true)).not.toHaveProperty('nameHidden');
  });
});

describe('triggeredByReference', () => {
  it('resolves a user trigger to a user reference', () => {
    expect(triggeredByReference('user', 'user-1')).toEqual({ kind: 'user', id: 'user-1' });
  });

  it('resolves a connector trigger to a service account reference', () => {
    expect(triggeredByReference('connector', 'sa-1')).toEqual({ kind: 'serviceAccount', id: 'sa-1' });
  });

  it('resolves nothing for a scheduler trigger', () => {
    expect(triggeredByReference('scheduler', null)).toBeNull();
  });

  it('resolves nothing for a system trigger answering an absorbed ask, which names a run rather than an entity', () => {
    expect(triggeredByReference('system', 'run-1')).toBeNull();
  });

  it('resolves nothing for an event trigger', () => {
    expect(triggeredByReference('event', null)).toBeNull();
  });

  it('resolves nothing when there is no id at all', () => {
    expect(triggeredByReference('user', null)).toBeNull();
  });
});
