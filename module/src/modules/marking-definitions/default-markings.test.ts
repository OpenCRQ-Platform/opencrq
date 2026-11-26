import { describe, expect, it } from 'vitest';
import { isProtectedMarking, knownMarkingRank } from './default-markings';
import { markingStixId } from './marking-stix-id';

const tlp = (definition: string) => markingStixId('TLP', definition);
const pap = (definition: string) => markingStixId('PAP', definition);

describe('knownMarkingRank', () => {
  it.each([
    [tlp('TLP:CLEAR'), 1],
    [tlp('TLP:GREEN'), 2],
    [tlp('TLP:AMBER'), 3],
    [tlp('TLP:AMBER+STRICT'), 4],
    [tlp('TLP:RED'), 5],
    [pap('PAP:CLEAR'), 1],
    [pap('PAP:GREEN'), 2],
    [pap('PAP:AMBER'), 3],
    [pap('PAP:RED'), 4],
  ])('should rank %s at %i, as OpenCTI ships it', (stixId, rank) => {
    expect(knownMarkingRank(stixId)).toBe(rank);
  });

  it('should rank nothing for a marking OpenCTI does not ship', () => {
    expect(knownMarkingRank(markingStixId('STATEMENT', 'Copyright'))).toBeUndefined();
    expect(knownMarkingRank('not-a-stix-id')).toBeUndefined();
  });
});

describe('isProtectedMarking', () => {
  it.each([tlp('TLP:RED'), tlp('TLP:CLEAR'), tlp('TLP:AMBER+STRICT')])('should protect the default marking %s', (stixId) => {
    expect(isProtectedMarking(stixId)).toBe(true);
  });

  it('should leave a PAP marking and a marking created by hand unprotected', () => {
    expect(isProtectedMarking(pap('PAP:RED'))).toBe(false);
    expect(isProtectedMarking(markingStixId('CUSTOM', 'CUSTOM:SECRET'))).toBe(false);
  });
});
