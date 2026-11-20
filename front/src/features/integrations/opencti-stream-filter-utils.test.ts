import { describeStream } from '@app/back/src/features/app-router/opencti/opencti-stream-filter-utils';
import { describe, expect, it } from 'vitest';
import type { OpenctiStream, StreamFilterGroup } from './opencti-stream-filter-utils';
import { configuredStreamAlarm, findConfiguredStream, formatRawFilter, streamAlarm, streamFilterPrecis } from './opencti-stream-filter-utils';

const entityType = (values: Array<string>) =>
  ({ key: ['entity_type'], operator: 'eq', mode: 'or' as const, values });

/** The type algebra on its own, under a verdict that never withholds what it found. */
const precisOf = (filterGroup: StreamFilterGroup | null, rawFilter: string | null = '{}') =>
  streamFilterPrecis(filterGroup, rawFilter, 'delivers');

const group = (partial: Partial<StreamFilterGroup>): StreamFilterGroup =>
  ({ mode: 'and', filters: [], filterGroups: [], ...partial });

const stream = (partial: Partial<OpenctiStream>): OpenctiStream => ({
  id: 'stream-1',
  name: 'Intrusion set',
  description: null,
  rawFilter: null,
  filterGroup: null,
  verdict: 'delivers',
  missingRelationships: [],
  replaysHistory: true,
  ...partial,
});

describe('streamFilterPrecis', () => {
  it('reports an absent filter apart from one it could not read', () => {
    expect(precisOf(null, null).kind).toBe('absent');
    expect(precisOf(null, 'not json').kind).toBe('unreadable');
  });

  it('reports a filter with no clause in it as constraining nothing', () => {
    expect(precisOf(group({})).kind).toBe('unconstrained');
  });

  it('names the types a filter admits, and says they are the whole filter', () => {
    expect(precisOf(group({ filters: [entityType(['Intrusion-Set'])] }))).toMatchObject({
      kind: 'entity-types',
      entityTypes: ['Intrusion-Set'],
      exhaustive: true,
    });
  });

  it('collects the types named in nested groups too', () => {
    const nested = group({
      mode: 'or',
      filters: [entityType(['Intrusion-Set'])],
      filterGroups: [group({ filters: [entityType(['targets'])] })],
    });
    expect(precisOf(nested).entityTypes).toEqual(['Intrusion-Set', 'targets']);
  });

  it('stops claiming the types are the whole filter once another key joins them', () => {
    const mixed = group({
      filters: [entityType(['Intrusion-Set']), { key: ['confidence'], operator: 'gte', mode: 'or', values: ['80'] }],
    });
    expect(precisOf(mixed)).toMatchObject({ exhaustive: false, keys: ['confidence'] });
  });

  it('falls back to the keys for a filter that names no type', () => {
    const byMarking = group({
      filters: [{ key: ['objectMarking'], operator: 'eq', mode: 'or', values: ['TLP:CLEAR'] }],
    });
    expect(precisOf(byMarking)).toMatchObject({ kind: 'other-keys', keys: ['objectMarking'] });
  });

  it('intersects the types under `and`, which admits only what every clause names', () => {
    const both = group({
      mode: 'and',
      filters: [entityType(['Intrusion-Set', 'Malware']), entityType(['Malware'])],
    });
    expect(precisOf(both)).toMatchObject({ kind: 'entity-types', entityTypes: ['Malware'] });
  });

  it('says a stream admits nothing rather than listing types no object can hold at once', () => {
    const contradictory = group({
      mode: 'and',
      filters: [entityType(['Intrusion-Set']), entityType(['Indicator'])],
    });
    expect(precisOf(contradictory)).toMatchObject({ kind: 'admits-nothing', entityTypes: [] });
  });

  it('unions the types under `or`, which admits what any clause names', () => {
    const either = group({
      mode: 'or',
      filters: [entityType(['Intrusion-Set']), entityType(['Indicator'])],
    });
    expect(precisOf(either)).toMatchObject({
      kind: 'entity-types',
      entityTypes: ['Intrusion-Set', 'Indicator'],
    });
  });

  it('reads a nested group under its own mode before folding it into its parent', () => {
    const nested = group({
      mode: 'and',
      filters: [entityType(['Intrusion-Set', 'Indicator'])],
      filterGroups: [group({ mode: 'or', filters: [entityType(['Indicator']), entityType(['Malware'])] })],
    });
    expect(precisOf(nested)).toMatchObject({ kind: 'entity-types', entityTypes: ['Indicator'] });
  });

  it('abstains on a negated type clause rather than reading it as the types it names', () => {
    const negated = group({
      filters: [{ key: ['entity_type'], operator: 'not_eq', mode: 'or', values: ['Indicator'] }],
    });
    expect(precisOf(negated)).toMatchObject({ kind: 'indeterminate', entityTypes: [] });
  });

  it('abstains on a clause asking for several types at once, as the verdict does', () => {
    const conjunctiveClause = group({
      filters: [{ key: ['entity_type'], operator: 'eq', mode: 'and', values: ['Intrusion-Set', 'Indicator'] }],
    });
    expect(precisOf(conjunctiveClause).kind).toBe('indeterminate');
  });

  it('abstains when a branch of an `or` lets every type through beside a type clause', () => {
    const widened = group({
      mode: 'or',
      filters: [entityType(['Intrusion-Set']), { key: ['confidence'], operator: 'gte', mode: 'or', values: ['80'] }],
    });
    expect(precisOf(widened).kind).toBe('indeterminate');
  });

  it('withholds the types it found when the verdict beside it could not judge them', () => {
    const container = group({ filters: [entityType(['Report'])] });
    expect(streamFilterPrecis(container, '{}', 'undecidable').kind).toBe('indeterminate');
  });

  it('still calls an unreadable filter unreadable, which says more than an abstention', () => {
    expect(streamFilterPrecis(null, 'not json', 'undecidable').kind).toBe('unreadable');
  });

  it('keeps the types beside a verdict that did read the filter', () => {
    const indicators = group({ filters: [entityType(['Indicator'])] });
    expect(streamFilterPrecis(indicators, '{}', 'no_actors')).toMatchObject({
      kind: 'entity-types',
      entityTypes: ['Indicator'],
    });
  });
});

/**
 * The picker puts the verdict chip and this line on the same row, so a filter must never come out
 * of the two halves saying two different things. The back is the half that owns what a type name
 * means, and it abstains on the ones it cannot classify.
 */
describe('the précis against the verdict the back reaches for the same filter', () => {
  const clause = (key: string, operator: string, values: Array<string>, mode: 'and' | 'or' = 'or') =>
    JSON.stringify({ key: [key], operator, mode, values });
  const and = (...filters: Array<string>) => `{"mode":"and","filters":[${filters.join(',')}],"filterGroups":[]}`;
  const or = (...filters: Array<string>) => `{"mode":"or","filters":[${filters.join(',')}],"filterGroups":[]}`;

  const cases: Array<[string, string]> = [
    ['only intrusion sets', and(clause('entity_type', 'eq', ['Intrusion-Set']))],
    ['only indicators', and(clause('entity_type', 'eq', ['Indicator']))],
    ['a container the back will not classify', and(clause('entity_type', 'eq', ['Report']))],
    ['an abstract parent that does extend to actors', and(clause('entity_type', 'eq', ['Stix-Domain-Object']))],
    ['two types no object can hold at once', and(clause('entity_type', 'eq', ['Intrusion-Set']), clause('entity_type', 'eq', ['Indicator']))],
    ['two unclassified types no object can hold at once', and(clause('entity_type', 'eq', ['Report']), clause('entity_type', 'eq', ['Grouping']))],
    ['either of two types', or(clause('entity_type', 'eq', ['Intrusion-Set']), clause('entity_type', 'eq', ['Indicator']))],
    ['an intersection that drops the actors', and(clause('entity_type', 'eq', ['Intrusion-Set', 'Malware']), clause('entity_type', 'eq', ['Malware']))],
    ['a negated type', and(clause('entity_type', 'not_eq', ['Indicator']))],
    ['several types demanded at once', and(clause('entity_type', 'eq', ['Intrusion-Set', 'Indicator'], 'and'))],
    ['no type at all', and(clause('confidence', 'gte', ['70']))],
    ['actors or a relationship branch', `{"mode":"or","filters":[${clause('entity_type', 'eq', ['Intrusion-Set'])}],"filterGroups":[${and(clause('entity_type', 'eq', ['targets']), clause('fromTypes', 'eq', ['Intrusion-Set']))}]}`],
  ];

  it.each(cases)('%s', (_name, filters) => {
    const described = describeStream({ id: 'stream-1', name: 'Stream', filters, stream_live: true });
    const precis = streamFilterPrecis(described.filterGroup, described.rawFilter, described.verdict);

    // `other-keys` and `unreadable` rule on no type at all, so they sit under any verdict.
    if (described.verdict === 'undecidable') {
      expect(['entity-types', 'admits-nothing']).not.toContain(precis.kind);
    }
    if (precis.kind === 'entity-types' && !precis.entityTypes.includes('Intrusion-Set')) {
      expect(described.verdict).not.toBe('delivers');
    }
  });
});

describe('streamAlarm', () => {
  it('raises nothing for a stream that feeds the connector and replays its history', () => {
    expect(streamAlarm(stream({ verdict: 'delivers', replaysHistory: true }))).toBeNull();
  });

  it('raises nothing for a verdict it could not reach', () => {
    expect(streamAlarm(stream({ verdict: 'undecidable', replaysHistory: true }))).toBeNull();
  });

  it('raises the missing replay on a stream that otherwise feeds the connector', () => {
    expect(streamAlarm(stream({ verdict: 'delivers', replaysHistory: false }))).toBe('no_history');
  });

  it('still raises the missing replay when the verdict could not be reached', () => {
    expect(streamAlarm(stream({ verdict: 'undecidable', replaysHistory: false }))).toBe('no_history');
  });

  it('prefers the verdict over the missing replay, which replaying could not fix', () => {
    expect(streamAlarm(stream({ verdict: 'no_actors', replaysHistory: false }))).toBe('no_actors');
    expect(streamAlarm(stream({ verdict: 'stopped', replaysHistory: false }))).toBe('stopped');
  });

  it('raises the banner on a bound stream that cannot supply the connector', () => {
    expect(streamAlarm(stream({ verdict: 'incompatible', replaysHistory: true }))).toBe('incompatible');
    expect(streamAlarm(stream({ verdict: 'incompatible', replaysHistory: false }))).toBe('incompatible');
  });

  it('raises nothing when no stream is bound yet', () => {
    expect(streamAlarm(null)).toBeNull();
  });
});

describe('configuredStreamAlarm', () => {
  it('raises nothing while the listing has not arrived', () => {
    expect(configuredStreamAlarm(undefined, 'stream-1')).toBeNull();
  });

  it('raises nothing when no stream is bound yet', () => {
    expect(configuredStreamAlarm([stream({})], null)).toBeNull();
  });

  it('raises the loudest alarm when the listing arrived without the bound stream in it', () => {
    expect(configuredStreamAlarm([stream({ id: 'other' })], 'stream-1')).toBe('missing');
  });

  it('passes a stream it did find on to its own verdict', () => {
    expect(configuredStreamAlarm([stream({ verdict: 'no_actors' })], 'stream-1')).toBe('no_actors');
    expect(configuredStreamAlarm([stream({ verdict: 'delivers' })], 'stream-1')).toBeNull();
  });
});

describe('findConfiguredStream', () => {
  it('finds the stream the connector is bound to', () => {
    expect(findConfiguredStream([stream({ id: 'a' }), stream({ id: 'b' })], 'b')?.id).toBe('b');
  });

  it('reports nothing when the listing has not arrived', () => {
    expect(findConfiguredStream(undefined, 'b')).toBeNull();
  });

  it('reports nothing when the bound stream is no longer listed', () => {
    expect(findConfiguredStream([stream({ id: 'a' })], 'b')).toBeNull();
  });
});

describe('formatRawFilter', () => {
  it('indents the filter OpenCTI stores as one line', () => {
    expect(formatRawFilter('{"mode":"and","filters":[]}')).toBe('{\n  "mode": "and",\n  "filters": []\n}');
  });

  it('leaves a filter that is not JSON exactly as it came', () => {
    expect(formatRawFilter('not json')).toBe('not json');
  });
});
