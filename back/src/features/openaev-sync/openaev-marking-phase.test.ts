import { markingStixId } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { OpenaevMarkingDefinition } from './openaev-types';
import type { OpenaevMarkingVocabulary } from './openaev-marking-phase';
import { openaevMarkingRefs } from './openaev-mapping-utils';
import { stixIdOfOpenaevMarking, syncOpenaevMarkings } from './openaev-marking-phase';

const TLP_RED_STIX = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

const marking = (id: string, type: string, definition: string, stixId: string | null = null): OpenaevMarkingDefinition => ({
  marking_definition_id: id,
  marking_definition_type: type,
  marking_definition_definition: definition,
  marking_definition_color: '#c62828',
  marking_definition_order: 4,
  marking_definition_stix_id: stixId,
});

describe('stixIdOfOpenaevMarking', () => {
  it('keeps the STIX id OpenAEV states', () => {
    expect(stixIdOfOpenaevMarking(marking('oaev-1', 'TLP', 'TLP:RED', TLP_RED_STIX))).toBe(TLP_RED_STIX);
  });

  it('derives it as OpenCTI does when OpenAEV holds none', () => {
    expect(stixIdOfOpenaevMarking(marking('oaev-2', 'PAP', 'PAP:RED'))).toBe(markingStixId('PAP', 'PAP:RED'));
  });

  it('derives it when the stated one is not a STIX marking id', () => {
    expect(stixIdOfOpenaevMarking(marking('oaev-3', 'PAP', 'PAP:RED', 'not-an-id'))).toBe(markingStixId('PAP', 'PAP:RED'));
  });

  it('answers null without a type or a definition', () => {
    expect(stixIdOfOpenaevMarking(marking('oaev-4', ' ', 'PAP:RED'))).toBeNull();
  });
});

describe('syncOpenaevMarkings', () => {
  const deps = (vocabulary: OpenaevMarkingVocabulary) => ({
    listAssignableMarkingDefinitions: vi.fn((_tenant: string) => Promise.resolve(vocabulary)),
    syncMarkingDefinitions: vi.fn((_markings: ReadonlyArray<unknown>) => Promise.resolve({ synced: 0, skipped: 0 })),
    warn: vi.fn(),
    signal: new AbortController().signal,
  });

  it('mirrors the assignable vocabulary under its STIX ids and answers the OpenAEV id map', async () => {
    const phase = deps({ available: true, markings: [marking('oaev-1', 'TLP', 'TLP:RED', TLP_RED_STIX), marking('oaev-2', 'PAP', 'PAP:RED')] });
    const map = await syncOpenaevMarkings(phase, 'oaev-tenant');
    expect(phase.listAssignableMarkingDefinitions).toHaveBeenCalledTimes(1);
    expect(phase.listAssignableMarkingDefinitions).toHaveBeenCalledWith('oaev-tenant');
    expect(map.get('oaev-1')).toBe(TLP_RED_STIX);
    expect(map.get('oaev-2')).toBe(markingStixId('PAP', 'PAP:RED'));
    expect(phase.syncMarkingDefinitions).toHaveBeenCalledWith([
      { stixId: TLP_RED_STIX, definitionType: 'TLP', definition: 'TLP:RED', color: '#c62828', order: 4 },
      { stixId: markingStixId('PAP', 'PAP:RED'), definitionType: 'PAP', definition: 'PAP:RED', color: '#c62828', order: 4 },
    ]);
    expect(phase.warn).not.toHaveBeenCalled();
  });

  it('writes nothing for an OpenAEV whose vocabulary is empty', async () => {
    const phase = deps({ available: true, markings: [] });
    const map = await syncOpenaevMarkings(phase, 'oaev-tenant');
    expect(map.size).toBe(0);
    expect(phase.syncMarkingDefinitions).not.toHaveBeenCalled();
    expect(phase.warn).not.toHaveBeenCalled();
  });

  it('warns once and answers an empty map when OpenAEV serves no vocabulary, so the sync goes on', async () => {
    const phase = deps({ available: false, reason: 'OpenAEV auth error (403): Forbidden' });
    const map = await syncOpenaevMarkings(phase, 'oaev-tenant');
    expect(map.size).toBe(0);
    expect(phase.syncMarkingDefinitions).not.toHaveBeenCalled();
    expect(phase.warn).toHaveBeenCalledTimes(1);
    expect(phase.warn).toHaveBeenCalledWith(expect.stringContaining('unavailable'), { openaevTenantId: 'oaev-tenant', reason: 'OpenAEV auth error (403): Forbidden' });
  });
});

describe('openaevMarkingRefs', () => {
  it('translates OpenAEV ids to STIX ids, deduplicated and sorted', () => {
    const map = new Map([['oaev-1', TLP_RED_STIX], ['oaev-2', 'marking-definition--00000000-0000-4000-8000-000000000001']]);
    expect(openaevMarkingRefs(['oaev-1', 'oaev-2', 'oaev-1'], map)).toEqual([
      'marking-definition--00000000-0000-4000-8000-000000000001',
      TLP_RED_STIX,
    ]);
  });

  it('keeps an id the map cannot resolve, so the asset fails closed', () => {
    expect(openaevMarkingRefs(['oaev-unknown'], new Map())).toEqual(['oaev-unknown']);
  });

  it('answers no marking for an asset that carries none', () => {
    expect(openaevMarkingRefs(null, new Map())).toEqual([]);
    expect(openaevMarkingRefs(undefined, new Map())).toEqual([]);
  });
});
