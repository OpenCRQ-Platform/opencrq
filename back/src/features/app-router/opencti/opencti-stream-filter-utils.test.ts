import { describe, expect, it } from 'vitest';
import { describeStream, describeStreams, groupAdmission, missingRelationships, parseFilterGroup, streamVerdict } from './opencti-stream-filter-utils';

const entityType = (values: Array<string>, mode: 'and' | 'or' = 'or') =>
  ({ key: ['entity_type'], operator: 'eq', mode, values });

const endType = (key: 'fromTypes' | 'toTypes', values: Array<string>) =>
  ({ key: [key], operator: 'eq', mode: 'or' as const, values });

const andOf = (...filters: Array<ReturnType<typeof entityType>>) =>
  ({ mode: 'and' as const, filters, filterGroups: [] });

const ACTOR = { entityType: 'Intrusion-Set' };
const USES_TECHNIQUE = { entityType: 'uses', fromType: 'Intrusion-Set', toType: 'Attack-Pattern' };
const TARGETS_LOCATION = { entityType: 'targets', fromType: 'Intrusion-Set', toType: 'Location' };

const THREAT_TYPES = ['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual', 'Campaign'];

const threatFilter = (options: { usesFrom?: Array<string>, attributions?: boolean } = {}) => ({
  mode: 'or' as const,
  filters: [],
  filterGroups: [
    andOf(entityType(THREAT_TYPES)),
    andOf(entityType(['targets']), endType('fromTypes', THREAT_TYPES), endType('toTypes', ['Location', 'Sector', 'Vulnerability'])),
    andOf(entityType(['uses']), endType('fromTypes', options.usesFrom ?? THREAT_TYPES), endType('toTypes', ['Attack-Pattern'])),
    ...(options.attributions === false
      ? []
      : [andOf(entityType(['attributed-to']), endType('fromTypes', ['Campaign', 'Intrusion-Set']), endType('toTypes', ['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual']))]),
  ],
});

const SUPPLYING_FILTER = {
  mode: 'or' as const,
  filters: [],
  filterGroups: [
    andOf(entityType(['Intrusion-Set'])),
    andOf(entityType(['targets']), endType('fromTypes', ['Intrusion-Set']), endType('toTypes', ['Location', 'Sector', 'Vulnerability'])),
    andOf(entityType(['uses']), endType('fromTypes', ['Intrusion-Set']), endType('toTypes', ['Attack-Pattern'])),
  ],
};

describe('parseFilterGroup', () => {
  it('reads the filter the stream in use carries', () => {
    expect(parseFilterGroup('{"mode":"and","filters":[{"key":["entity_type"],"operator":"eq","values":["Intrusion-Set"]}],"filterGroups":[]}')).toEqual({
      mode: 'and',
      filters: [{ key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] }],
      filterGroups: [],
    });
  });

  it('accepts a key given as a bare string rather than an array', () => {
    const group = parseFilterGroup('{"mode":"and","filters":[{"key":"entity_type","operator":"eq","values":["Report"]}],"filterGroups":[]}');
    expect(group?.filters[0]?.key).toEqual(['entity_type']);
  });

  it('returns null for a filter carrying a value it cannot render', () => {
    expect(parseFilterGroup('{"mode":"and","filters":[{"key":["objectMarking"],"operator":"eq","values":[{"id":"x"}]}],"filterGroups":[]}')).toBeNull();
  });

  it('returns null for a filter that is not JSON', () => {
    expect(parseFilterGroup('not json')).toBeNull();
  });

  it('returns null for a filter nested deep enough to exhaust the stack, rather than throwing', () => {
    let nested = '{"mode":"and","filters":[],"filterGroups":[]}';
    for (let depth = 0; depth < 30000; depth += 1) {
      nested = `{"mode":"and","filters":[],"filterGroups":[${nested}]}`;
    }
    expect(parseFilterGroup(nested)).toBeNull();
  });

  it('returns null for an absent filter', () => {
    expect(parseFilterGroup(null)).toBeNull();
    expect(parseFilterGroup('   ')).toBeNull();
  });
});

describe('groupAdmission', () => {
  it('admits an intrusion set when the filter names it', () => {
    expect(groupAdmission(andOf(entityType(['Intrusion-Set'])), ACTOR)).toBe('yes');
  });

  it('admits an intrusion set through an abstract parent that covers it', () => {
    expect(groupAdmission(andOf(entityType(['Stix-Domain-Object'])), ACTOR)).toBe('yes');
  });

  it('refuses a filter whose types are all known not to be intrusion sets', () => {
    expect(groupAdmission(andOf(entityType(['Indicator', 'Malware'])), ACTOR)).toBe('no');
  });

  it('refuses under `and` as soon as one clause refuses, whatever the others say', () => {
    expect(groupAdmission(andOf(entityType(['Indicator']), entityType(['Intrusion-Set'])), ACTOR)).toBe('no');
  });

  it('refuses a relationship to a filter naming only entity types', () => {
    expect(groupAdmission(andOf(entityType(['Intrusion-Set'])), USES_TECHNIQUE)).toBe('no');
  });

  it('refuses an entity to a clause on a relationship end, which an entity does not have', () => {
    expect(groupAdmission(andOf(endType('fromTypes', ['Intrusion-Set'])), ACTOR)).toBe('no');
  });

  it('cannot judge a type that names only part of what the candidate covers', () => {
    expect(groupAdmission(
      andOf(entityType(['targets']), endType('toTypes', ['Country'])),
      TARGETS_LOCATION,
    )).toBe('unknown');
  });

  it('admits both kinds of threat actor through their abstract parent', () => {
    expect(groupAdmission(andOf(entityType(['Threat-Actor'])), { entityType: 'Threat-Actor-Group' })).toBe('yes');
    expect(groupAdmission(andOf(entityType(['Threat-Actor'])), { entityType: 'Threat-Actor-Individual' })).toBe('yes');
  });

  it('refuses one kind of threat actor to a filter naming only the other', () => {
    expect(groupAdmission(andOf(entityType(['Threat-Actor-Group'])), { entityType: 'Threat-Actor-Individual' })).toBe('no');
  });

  it('cannot judge a container type, whose contents the filter does not describe', () => {
    expect(groupAdmission(andOf(entityType(['Report'])), ACTOR)).toBe('unknown');
  });

  it('cannot judge a clause on any key other than a type', () => {
    expect(groupAdmission({
      mode: 'and',
      filters: [{ key: ['objectMarking'], operator: 'eq', mode: 'or', values: ['TLP:CLEAR'] }],
      filterGroups: [],
    }, ACTOR)).toBe('unknown');
  });

  it('cannot judge a negated clause', () => {
    expect(groupAdmission({
      mode: 'and',
      filters: [{ key: ['entity_type'], operator: 'not_eq', mode: 'or', values: ['Indicator'] }],
      filterGroups: [],
    }, ACTOR)).toBe('unknown');
  });

  it('narrows to unknown when a clause it can read is joined by one it cannot', () => {
    expect(groupAdmission({
      mode: 'and',
      filters: [entityType(['Intrusion-Set']), { key: ['confidence'], operator: 'gt', mode: 'or', values: ['80'] }],
      filterGroups: [],
    }, ACTOR)).toBe('unknown');
  });

  it('admits a group of alternatives as soon as one of them admits the candidate', () => {
    expect(groupAdmission(SUPPLYING_FILTER, USES_TECHNIQUE)).toBe('yes');
  });

  it('refuses a group of alternatives only when every one of them refuses', () => {
    expect(groupAdmission({
      mode: 'or',
      filters: [entityType(['Indicator']), entityType(['Malware'])],
      filterGroups: [],
    }, ACTOR)).toBe('no');
  });

  it('treats an empty group as no constraint at all', () => {
    expect(groupAdmission({ mode: 'and', filters: [], filterGroups: [] }, ACTOR)).toBe('yes');
  });
});

describe('streamVerdict', () => {
  it('reports a stopped stream before looking at its filter', () => {
    expect(streamVerdict({
      streamLive: false,
      rawFilter: '{"mode":"and","filters":[{"key":["entity_type"],"operator":"eq","values":["Intrusion-Set"]}],"filterGroups":[]}',
      filterGroup: andOf(entityType(['Intrusion-Set'])),
    })).toBe('stopped');
  });

  it('reports a stream with no filter as delivering', () => {
    expect(streamVerdict({ streamLive: true, rawFilter: null, filterGroup: null })).toBe('delivers');
  });

  it('tells a filter it could not read apart from an absent one', () => {
    expect(streamVerdict({ streamLive: true, rawFilter: 'not json', filterGroup: null })).toBe('undecidable');
  });

  it('reports a stream admitting no threat type as carrying no threat actor', () => {
    expect(streamVerdict({
      streamLive: true,
      rawFilter: '{}',
      filterGroup: andOf(entityType(['Indicator'])),
    })).toBe('no_actors');
  });

  it('reports a filter admitting actors without their relationships as incompatible', () => {
    expect(streamVerdict({
      streamLive: true,
      rawFilter: '{}',
      filterGroup: andOf(entityType(['Intrusion-Set'])),
    })).toBe('incompatible');
  });

  it('reports a filter admitting the actors and every relationship the parser reads as delivering', () => {
    expect(streamVerdict({ streamLive: true, rawFilter: '{}', filterGroup: SUPPLYING_FILTER })).toBe('delivers');
  });

  it('refuses a filter missing one of the targets, since the rest would arrive without it', () => {
    expect(streamVerdict({
      streamLive: true,
      rawFilter: '{}',
      filterGroup: {
        mode: 'or',
        filters: [],
        filterGroups: [
          andOf(entityType(['Intrusion-Set'])),
          andOf(entityType(['targets']), endType('fromTypes', ['Intrusion-Set']), endType('toTypes', ['Location', 'Sector'])),
          andOf(entityType(['uses']), endType('fromTypes', ['Intrusion-Set']), endType('toTypes', ['Attack-Pattern'])),
        ],
      },
    })).toBe('incompatible');
  });

  /**
   * `entity_type = Intrusion-Set` lets no relationship through whatever the confidence clause does,
   * so the refusal is certain even though the actor admission is not. Abstaining here would hide a
   * defect the check can prove.
   */
  it('reports a certain refusal of the relationships even when the actor admission is unknown', () => {
    expect(streamVerdict({
      streamLive: true,
      rawFilter: '{}',
      filterGroup: {
        mode: 'and',
        filters: [entityType(['Intrusion-Set']), { key: ['confidence'], operator: 'gt', mode: 'or', values: ['80'] }],
        filterGroups: [],
      },
    })).toBe('incompatible');
  });

  it('reports a filter admitting every threat type with its relationships as delivering', () => {
    expect(streamVerdict({ streamLive: true, rawFilter: '{}', filterGroup: threatFilter() })).toBe('delivers');
  });

  it('reports a filter admitting campaigns without the uses leaving them as incompatible, naming that one', () => {
    const filterGroup = threatFilter({ usesFrom: ['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual'] });
    expect(streamVerdict({ streamLive: true, rawFilter: '{}', filterGroup })).toBe('incompatible');
    expect(missingRelationships(filterGroup)).toEqual(['campaign_uses_technique']);
  });

  it('requires the attributions once it admits two threat types', () => {
    const filterGroup = threatFilter({ attributions: false });
    expect(streamVerdict({ streamLive: true, rawFilter: '{}', filterGroup })).toBe('incompatible');
    expect(missingRelationships(filterGroup)).toEqual(['attributed_to']);
  });

  it('does not require the relationships of a threat type the filter certainly refuses', () => {
    expect(missingRelationships(SUPPLYING_FILTER)).toEqual([]);
  });

  /**
   * The campaigns may or may not come through the confidence clause, and a campaign that does
   * arrives without its techniques: only one of those two readings is a loss.
   */
  it('abstains when the refused relationship belongs to a threat type it cannot tell is admitted', () => {
    expect(streamVerdict({
      streamLive: true,
      rawFilter: '{}',
      filterGroup: {
        ...SUPPLYING_FILTER,
        filterGroups: [
          ...SUPPLYING_FILTER.filterGroups,
          { mode: 'and', filters: [entityType(['Campaign']), { key: ['confidence'], operator: 'gt', mode: 'or', values: ['80'] }], filterGroups: [] },
        ],
      },
    })).toBe('undecidable');
  });

  it('abstains rather than refusing when a clause it cannot read is what would decide', () => {
    expect(streamVerdict({
      streamLive: true,
      rawFilter: '{}',
      filterGroup: {
        mode: 'or',
        filters: [{ key: ['objectMarking'], operator: 'eq', mode: 'or', values: ['TLP:CLEAR'] }],
        filterGroups: [],
      },
    })).toBe('undecidable');
  });
});

describe('describeStream', () => {
  it('reports an entities-only filter as unable to supply the connector', () => {
    expect(describeStream({
      id: '42d1d53e',
      name: 'Intrusion set',
      filters: '{"mode":"and","filters":[{"key":["entity_type"],"operator":"eq","values":["Intrusion-Set"]}],"filterGroups":[]}',
      stream_live: true,
    })).toMatchObject({ verdict: 'incompatible', replaysHistory: true });
  });

  it('reports a stream carrying an origin filter as replaying no history', () => {
    expect(describeStream({
      id: 'x',
      name: 'Partner feed',
      filters: null,
      origin_filters: '{"mode":"and","filters":[{"key":["source"],"operator":"eq","values":["connector"]}],"filterGroups":[]}',
      stream_live: true,
    })).toMatchObject({ verdict: 'delivers', replaysHistory: false });
  });

  it('leaves the history replay alone for an origin filter group with no clause in it', () => {
    expect(describeStream({
      id: 'x',
      name: 'Partner feed',
      origin_filters: '{"mode":"and","filters":[],"filterGroups":[]}',
      stream_live: true,
    }).replaysHistory).toBe(true);
  });

  it('reports an origin filter it cannot read as suppressing the replay', () => {
    expect(describeStream({
      id: 'x',
      name: 'Partner feed',
      origin_filters: 'not json',
      stream_live: true,
    }).replaysHistory).toBe(false);
  });

  it('treats an absent stream_live as a running stream', () => {
    expect(describeStream({ id: 'x', name: 'Whatever' }).verdict).toBe('delivers');
  });
});

describe('describeStreams', () => {
  const named = (...names: Array<string>) =>
    describeStreams(names.map((name, index) => ({ id: String(index), name }))).map((stream) => stream.name);

  it('orders the streams by name, whatever order OpenCTI listed them in', () => {
    expect(named('Splunk', 'Intrusion set', 'AshTest-Defender')).toEqual(['AshTest-Defender', 'Intrusion set', 'Splunk']);
  });

  it('ignores case, so a lowercase name is not exiled to the end', () => {
    expect(named('Zebra', 'apple', 'Banana')).toEqual(['apple', 'Banana', 'Zebra']);
  });

  it('files an accented name next to its unaccented neighbours', () => {
    expect(named('Baker', 'Angélique', 'Charlie')).toEqual(['Angélique', 'Baker', 'Charlie']);
  });

  it('reads a trailing number as a number, not as text', () => {
    expect(named('Test 10', 'Test 2')).toEqual(['Test 2', 'Test 10']);
  });
});
