import { markingStixId } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { OpenaevMarkingDefinition } from './openaev-types';
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
  it('mirrors every page under its STIX id and answers the OpenAEV id map', async () => {
    const pages = [
      { content: [marking('oaev-1', 'TLP', 'TLP:RED', TLP_RED_STIX)], last: false },
      { content: [marking('oaev-2', 'PAP', 'PAP:RED')], last: true },
    ];
    const searchMarkingDefinitions = vi.fn((_tenant: string, page: number) => Promise.resolve(pages[page]));
    const syncMarkingDefinitions = vi.fn(() => Promise.resolve({ synced: 2, skipped: 0 }));
    const map = await syncOpenaevMarkings({ searchMarkingDefinitions, syncMarkingDefinitions, signal: new AbortController().signal }, 'oaev-tenant');
    expect(searchMarkingDefinitions).toHaveBeenCalledTimes(2);
    expect(map.get('oaev-1')).toBe(TLP_RED_STIX);
    expect(map.get('oaev-2')).toBe(markingStixId('PAP', 'PAP:RED'));
    expect(syncMarkingDefinitions).toHaveBeenCalledWith([
      { stixId: TLP_RED_STIX, definitionType: 'TLP', definition: 'TLP:RED', color: '#c62828', order: 4 },
      { stixId: markingStixId('PAP', 'PAP:RED'), definitionType: 'PAP', definition: 'PAP:RED', color: '#c62828', order: 4 },
    ]);
  });

  it('writes nothing for an OpenAEV without markings', async () => {
    const syncMarkingDefinitions = vi.fn(() => Promise.resolve({ synced: 0, skipped: 0 }));
    const map = await syncOpenaevMarkings({
      searchMarkingDefinitions: () => Promise.resolve({ content: [], last: true }),
      syncMarkingDefinitions,
      signal: new AbortController().signal,
    }, 'oaev-tenant');
    expect(map.size).toBe(0);
    expect(syncMarkingDefinitions).not.toHaveBeenCalled();
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
