import { describe, expect, it } from 'vitest';
import { buildDefaultMarkingRows, DEFAULT_MARKINGS } from './default-markings';
import { isMarkingStixId, markingStixId } from './marking-stix-id';

describe('markingStixId', () => {
  it.each([
    ['TLP:CLEAR', 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9'],
    ['TLP:WHITE', 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9'],
    ['TLP:GREEN', 'marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da'],
    ['TLP:AMBER', 'marking-definition--f88d31f6-486f-44da-b317-01333bde0b82'],
    ['TLP:AMBER+STRICT', 'marking-definition--826578e1-40ad-459f-bc73-ede076f81f37'],
    ['TLP:RED', 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed'],
  ])('should give %s the static id OpenCTI ships', (definition, expected) => {
    expect(markingStixId('TLP', definition)).toBe(expected);
  });

  it('should match OpenCTI on case, since both members are upper-cased', () => {
    expect(markingStixId('tlp', 'tlp:red')).toBe(markingStixId('TLP', 'TLP:RED'));
    expect(markingStixId('PAP', 'pap:green')).toBe(markingStixId('PAP', 'PAP:GREEN'));
  });

  it('should derive a UUIDv5 in the OASIS namespace for any other marking, stable and distinct', () => {
    const pap = markingStixId('PAP', 'PAP:GREEN');

    expect(isMarkingStixId(pap)).toBe(true);
    expect(pap).toBe(markingStixId('PAP', 'PAP:GREEN'));
    expect(pap).not.toBe(markingStixId('PAP', 'PAP:AMBER'));
    expect(pap).not.toBe(markingStixId('STATEMENT', 'PAP:GREEN'));
    expect(pap.slice('marking-definition--'.length).charAt(14)).toBe('5');
  });

  it('should give the id pycti generate_id gives the same marking', () => {
    // uuid5(OASIS namespace, '{"definition":"PAP:GREEN","definition_type":"PAP"}'), computed with Python's uuid module.
    expect(markingStixId('PAP', 'PAP:GREEN')).toBe('marking-definition--89484dde-e3d2-547f-a6c6-d14824429eb1');
  });

  it('should refuse a value that is not a marking id', () => {
    expect(isMarkingStixId('identity--613f2e26-407d-48c7-9eca-b8e91df99dc9')).toBe(false);
    expect(isMarkingStixId('marking-definition--not-a-uuid')).toBe(false);
  });
});

describe('buildDefaultMarkingRows', () => {
  it('should seed the TLP 2.0 markings under their OpenCTI ids, ranked as OpenAEV ranks them', () => {
    const rows = buildDefaultMarkingRows('0196f0a4-0000-7000-8000-000000000001');

    expect(rows.map((row) => [row.definition, row.order])).toEqual(DEFAULT_MARKINGS.map((seed) => [seed.definition, seed.order]));
    expect(rows.every((row) => row.stixId === markingStixId(row.definitionType, row.definition))).toBe(true);
  });

  it('should give each tenant its own stable row ids', () => {
    const first = buildDefaultMarkingRows('0196f0a4-0000-7000-8000-000000000001');
    const again = buildDefaultMarkingRows('0196f0a4-0000-7000-8000-000000000001');
    const other = buildDefaultMarkingRows('0196f0a4-0000-7000-8000-000000000002');

    expect(again.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(new Set([...first, ...other].map((row) => row.id)).size).toBe(first.length * 2);
  });
});
