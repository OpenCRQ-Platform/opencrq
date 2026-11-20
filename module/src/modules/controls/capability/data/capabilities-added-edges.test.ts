import { describe, expect, it } from 'vitest';
import { controlCapabilitiesData, controlCapabilityEdgesData } from './capabilities.generated';

const edgesOf = (externalId: string, fn: 'prevent' | 'detect', technique: string): Array<string> => {
  const capability = controlCapabilitiesData.find((cap) => cap.externalId === externalId);
  if (!capability) {
    throw new Error(`capability ${externalId} missing from the catalogue`);
  }
  return controlCapabilityEdgesData
    .filter((edge) => edge.capabilityId === capability.id && edge.function === fn && edge.techniqueExternalId.startsWith(technique))
    .map((edge) => edge.techniqueExternalId)
    .sort();
};

// The defense catalogue gives T1697 detection only and T1696 a block only; the tool adds these edges
// by hand, so a regeneration that loses them fails here instead of reading as one more count to update.
describe('the catalogue edges the defense-catalogue tool adds by hand', () => {
  it('lets IDP block app password theft (T1697), and leaves SSPM detecting it only', () => {
    expect(edgesOf('IDP', 'prevent', 'T1697')).toEqual(['T1697']);
    expect(edgesOf('SSPM', 'prevent', 'T1697')).toEqual([]);
    expect(edgesOf('SSPM', 'detect', 'T1697')).toEqual(['T1697']);
  });

  it('lets WAF detect anti-automation evasion (T1696), and keeps its block on the sub-techniques', () => {
    expect(edgesOf('WAF', 'detect', 'T1696')).toEqual(['T1696', 'T1696.001', 'T1696.002']);
    expect(edgesOf('WAF', 'prevent', 'T1696')).toEqual(['T1696', 'T1696.001', 'T1696.002']);
  });
});
