import { describe, expect, it } from 'vitest';
import { controlCapabilitiesData, controlCapabilityStrengthRungLabelsData } from '../../controls/capability/data/capabilities.generated';
import { PHISHING_STAGE_ANCHORS } from './attack-run-constants';

const labelsOf = (externalId: string): Record<string, string> => {
  const capability = controlCapabilitiesData.find((cap) => cap.externalId === externalId);
  if (!capability) {
    throw new Error(`capability ${externalId} missing from the catalogue`);
  }
  return Object.fromEntries(controlCapabilityStrengthRungLabelsData
    .filter((label) => label.capabilityId === capability.id)
    .map((label) => [label.rung, label.label]));
};

// The engine reads these controls' rungs at their phishing stage as measured values: a label that
// stops naming the mechanism its anchor was measured on moves the meaning of every declared rung.
const ANCHOR_MECHANISMS: Record<string, Record<'L1' | 'L2' | 'L3', RegExp>> = {
  SEG: { L1: /reputation and signature/, L2: /sandbox/, L3: /content disarm/ },
  IDP: { L1: /SMS/, L2: /number matching/, L3: /Phishing-resistant .*FIDO2/ },
};

describe('the rung labels of the controls read against measured phishing anchors', () => {
  it('pins every anchored control', () => {
    expect(Object.keys(ANCHOR_MECHANISMS).sort()).toEqual(Object.keys(PHISHING_STAGE_ANCHORS).sort());
  });

  it.each(Object.entries(ANCHOR_MECHANISMS))('%s names, at each rung, the mechanism pinned for its anchor', (externalId, mechanisms) => {
    const labels = labelsOf(externalId);
    for (const [rung, mechanism] of Object.entries(mechanisms)) {
      expect(labels[rung]).toMatch(mechanism);
    }
  });
});
