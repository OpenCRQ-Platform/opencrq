import { describe, expect, it } from 'vitest';
import { parseThreatBundle } from '../../modules/threat-analyses/stix-bundle-parser';
import { buildAcmeThreatBundle } from './acme-threat-bundle';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

describe('buildAcmeThreatBundle', () => {
  const parsed = parseThreatBundle(buildAcmeThreatBundle(NOW));
  const byName = new Map(parsed.map((entry) => [entry.threat.name, entry]));

  it('is read by the import parser as the seventeen demo threats', () => {
    expect(parsed).toHaveLength(17);
    expect([...byName.keys()]).toEqual(expect.arrayContaining([
      'Salt Typhoon', 'APT29 (Cozy Bear)', 'Lazarus Group', 'Sandworm Team', 'PhantomLocker', 'HollowTide', 'UNC-Drift',
    ]));
  });

  it('carries a threat actor that is none of the intrusion sets, attributed to by one of them', () => {
    const kraken = byName.get('Kraken Syndicate')!;

    expect(kraken.threat).toMatchObject({ entityType: 'threat-actor', sophistication: 'expert' });
    expect(kraken.threatActorTypes).toEqual(['crime-syndicate']);
    expect(byName.get('UNC-Drift')!.attributions.map((a) => a.targetStixId)).toEqual([kraken.threat.stixId]);
  });

  it('carries a campaign attributed to an intrusion set', () => {
    const campaign = byName.get('Operation Ledger Lure')!;

    expect(campaign.threat).toMatchObject({ entityType: 'campaign', objective: 'Divert outgoing payments by taking over back-office accounts' });
    expect(campaign.attributions.map((a) => a.targetStixId)).toEqual([byName.get('Scattered Spider')!.threat.stixId]);
  });

  // The campaign dates its attributed intrusion set, which states no window of its own.
  it('carries a campaign that dates an authored intrusion set', () => {
    const campaign = byName.get('Operation Gilded Checkout')!;
    const fin7 = byName.get('FIN7')!;

    expect(campaign.threat).toMatchObject({ entityType: 'campaign' });
    expect(campaign.threat.lastSeen).toEqual(daysAgo(14));
    expect(campaign.attributions).toHaveLength(1);
    expect(campaign.attributions[0]).toMatchObject({ targetStixId: fin7.threat.stixId, relConfidence: 75 });
    expect(fin7.threat.firstSeen).toBeNull();
    expect(fin7.threat.lastSeen).toBeNull();
  });

  it('carries the stated attributes of an observed actor', () => {
    const saltTyphoon = byName.get('Salt Typhoon')!;

    expect(saltTyphoon.threat).toMatchObject({
      stixId: 'intrusion-set--seed-salt-typhoon',
      mitreGroupId: 'G1045',
      confidence: 85,
      primaryMotivation: 'dominance',
      resourceLevel: 'government',
    });
    expect(saltTyphoon.threat.firstSeen).toEqual(daysAgo(1500));
    expect(saltTyphoon.threat.lastSeen).toEqual(daysAgo(4));
    expect(saltTyphoon.aliases).toEqual(['GhostEmperor', 'Earth Estries', 'FamousSparrow', 'UNC2286']);
  });

  it('carries each claim kind of an actor, dated from the run', () => {
    const saltTyphoon = byName.get('Salt Typhoon')!;

    expect(saltTyphoon.techniques.map((technique) => technique.mitreExternalId))
      .toEqual(['T1027', 'T1557', 'T1040', 'T1114', 'T1005', 'T1070', 'T1133', 'T1213']);
    expect(saltTyphoon.locations.map((location) => location.country))
      .toEqual(['United States of America', 'United States of America', 'France', 'Singapore']);
    expect(saltTyphoon.sectors.map((sector) => sector.name))
      .toEqual(['Telecommunications', 'Finance', 'Government and administrations']);
    expect(saltTyphoon.cves.map((cve) => cve.cveId))
      .toEqual(['CVE-2024-21762', 'CVE-2023-46805', 'CVE-2021-26855']);

    const sniffing = saltTyphoon.techniques.find((technique) => technique.mitreExternalId === 'T1040')!;
    expect(sniffing.name).toBe('Network Sniffing');
    expect(sniffing.relCreated).toEqual(daysAgo(9));
    expect(sniffing.relStartTime).toEqual(daysAgo(9));
    expect(sniffing.relConfidence).toBe(90);
  });

  it('keeps the below-gate claim the demo proves inert', () => {
    const saltTyphoon = byName.get('Salt Typhoon')!;
    const gated = saltTyphoon.techniques.find((technique) => technique.mitreExternalId === 'T1027')!;

    expect(gated.relConfidence).toBe(30);
    const stated = (claim: { relStartTime: Date | null, relCreated: Date | null }) => (claim.relStartTime ?? claim.relCreated!);
    expect(saltTyphoon.techniques.every((technique) => technique === gated || stated(technique) <= stated(gated))).toBe(true);
  });

  it('names the producer of each claim, and marks the inferred one', () => {
    const saltTyphoon = byName.get('Salt Typhoon')!;

    expect(new Set(saltTyphoon.locations.map((location) => location.producerName)))
      .toEqual(new Set(['Demo Intel Feed', 'Partner Intel Feed']));
    expect(saltTyphoon.locations.filter((location) => location.isInferred)).toHaveLength(1);
    expect(saltTyphoon.locations.every((location) => location.stixRelationId.length > 0)).toBe(true);
  });

  // An authored actor's claims decay on the long half-life, which only the missing activity window
  // can grade: a `last_seen` on the parent would grade the actor observed on its own.
  it('leaves an authored actor without an activity window', () => {
    const apt29 = byName.get('APT29 (Cozy Bear)')!;

    expect(apt29.threat.lastSeen).toBeNull();
    expect(apt29.threat.firstSeen).toBeNull();
    expect(apt29.techniques.every((technique) => technique.relStartTime === null)).toBe(true);
    expect(apt29.techniques.every((technique) => technique.relCreated !== null)).toBe(true);
    expect(apt29.secondaryMotivations).toEqual(['espionage']);
  });

  it('carries the declared motivation and goal cases the demo tenant exercises', () => {
    expect(byName.get('Lazarus Group')!.goals).toEqual(['ideology']);
    expect(byName.get('Sandworm Team')!.goals).toEqual(['Disrupt regional power grid operations for as long as possible']);

    const phantomLocker = byName.get('PhantomLocker')!;
    expect(phantomLocker.threat.primaryMotivation).toBe('ransomware');
    expect(phantomLocker.locations).toHaveLength(0);
    expect(phantomLocker.sectors).toHaveLength(0);
    expect(phantomLocker.techniques).toHaveLength(0);

    const hollowTide = byName.get('HollowTide')!;
    expect(hollowTide.locations.map((location) => location.country)).toEqual(['Brazil']);
    expect(hollowTide.sectors.map((sector) => sector.name)).toEqual(['Manufacturing']);
    expect(hollowTide.techniques.map((technique) => technique.mitreExternalId)).toEqual(['T1486']);

    const uncDrift = byName.get('UNC-Drift')!;
    expect(uncDrift.threat.primaryMotivation).toBeNull();
    expect(uncDrift.threat.resourceLevel).toBeNull();
    expect(uncDrift.secondaryMotivations).toHaveLength(0);
    expect(uncDrift.goals).toEqual(['data breach']);
  });

  it('gives the attack run engine the routine tradecraft to walk', () => {
    const lockbit = byName.get('LockBit')!;
    const externalIds = lockbit.techniques.map((technique) => technique.mitreExternalId);

    expect(externalIds).toEqual(expect.arrayContaining(['T1566', 'T1190', 'T1059', 'T1547', 'T1068', 'T1562', 'T1018', 'T1082', 'T1021', 'T1570', 'T1071', 'T1105']));
    expect(new Set(externalIds).size).toBe(externalIds.length);
  });
});
