import { describe, expect, it } from 'vitest';
import { controlCapabilitiesData, controlCapabilityEdgesData } from './capabilities.generated';

const idOf = (externalId: string): string => {
  const capability = controlCapabilitiesData.find((cap) => cap.externalId === externalId);
  if (!capability) {
    throw new Error(`capability ${externalId} missing from the catalogue`);
  }
  return capability.id;
};

const phishingEdgesOf = (externalId: string, fn: 'prevent' | 'detect'): Array<string> => {
  const capabilityId = idOf(externalId);
  return controlCapabilityEdgesData
    .filter((edge) => edge.capabilityId === capabilityId && edge.function === fn && edge.techniqueExternalId.startsWith('T1566'))
    .map((edge) => edge.techniqueExternalId)
    .sort();
};

// The delivery stage of phishing reads the prevent edges on T1566: a control acting on the payload
// (through T1204) must not sit there, or it lowers credential phishing too.
describe('the catalogue edges on phishing delivery (T1566)', () => {
  it.each(['EDR', 'OSH', 'IPS', 'IDP', 'FRAUD', 'IDV'])('%s has no prevent edge on T1566 or its sub-techniques', (externalId) => {
    expect(phishingEdgesOf(externalId, 'prevent')).toEqual([]);
  });

  it('keeps the detect edges of EDR on T1566 and its sub-techniques', () => {
    expect(phishingEdgesOf('EDR', 'detect')).toEqual(['T1566', 'T1566.001', 'T1566.002', 'T1566.003', 'T1566.004']);
  });

  it('keeps the prevent edges of the controls that act on the email or the person', () => {
    expect(phishingEdgesOf('SEG', 'prevent')).toEqual(['T1566', 'T1566.001', 'T1566.002', 'T1566.004']);
    expect(phishingEdgesOf('SAT', 'prevent')).toEqual(['T1566', 'T1566.001', 'T1566.002', 'T1566.003', 'T1566.004']);
    expect(phishingEdgesOf('SWG', 'prevent')).toEqual(['T1566', 'T1566.002']);
  });

  it.each(['EDR', 'OSH'])('%s keeps its prevent edge on T1204, where it acts on the payload', (externalId) => {
    const capabilityId = idOf(externalId);
    const onPayload = controlCapabilityEdgesData.filter(
      (edge) => edge.capabilityId === capabilityId && edge.function === 'prevent' && edge.techniqueExternalId === 'T1204',
    );
    expect(onPayload.length).toBeGreaterThan(0);
  });
});

const preventedBy = (externalId: string): Array<string> => {
  const capabilityId = idOf(externalId);
  return controlCapabilityEdgesData
    .filter((edge) => edge.capabilityId === capabilityId && edge.function === 'prevent')
    .map((edge) => edge.techniqueExternalId);
};

// The credential stage reads the prevent edges on T1078 over every family a control protects, and
// takes a control off the payload stage: the catalogue's backup link on domain accounts holds for
// the backup console alone, and hardening's local admin links would leave its macro blocking unread.
describe('the catalogue edges on valid accounts (T1078)', () => {
  it('leaves backup protection out of it, and keeps its edges on destruction', () => {
    const prevented = preventedBy('BKP');
    expect(prevented.filter((technique) => technique.startsWith('T1078'))).toEqual([]);
    expect(prevented).toEqual(expect.arrayContaining(['T1485', 'T1486', 'T1490']));
  });

  it('leaves system hardening out of it, and keeps its edges on the payload', () => {
    const prevented = preventedBy('OSH');
    expect(prevented.filter((technique) => technique.startsWith('T1078'))).toEqual([]);
    expect(prevented).toEqual(expect.arrayContaining(['T1203', 'T1204']));
  });
});
