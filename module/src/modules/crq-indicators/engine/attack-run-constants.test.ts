import { describe, expect, it } from 'vitest';
import { ACTOR_CLASS_VALUES } from '../../threat-analyses/actor-classes';
import {
  PHISHING_CAMPAIGN_BY_CLASS,
  PHISHING_CONSTANTS,
  PHISHING_TRAINING_CAPABILITIES,
  phishingCampaignSize,
} from './attack-run-constants';

describe('the phishing constants', () => {
  it('ships the susceptibility, the credential share and the client exploit share', () => {
    expect(PHISHING_CONSTANTS).toEqual({
      defaultSusceptibility: 0.07,
      credentialShare: 0.7,
      clientExploitShare: 0.2,
    });
  });

  it('reads the awareness training capability as the one a declared rate is measured under', () => {
    expect(PHISHING_TRAINING_CAPABILITIES).toEqual(['SAT']);
  });
});

describe('the phishing campaign size', () => {
  it('holds an entry for every actor class', () => {
    expect(Object.keys(PHISHING_CAMPAIGN_BY_CLASS).sort()).toEqual([...ACTOR_CLASS_VALUES].sort());
  });

  it.each(['state_sponsored', 'default', 'hacktivist'] as const)('targets a fixed number of people for %s', (actorClass) => {
    expect(phishingCampaignSize(actorClass, 5000)).toBe(10);
    expect(phishingCampaignSize(actorClass, 60)).toBe(10);
  });

  it.each(['state_sponsored', 'default', 'hacktivist'] as const)('never targets more people than the scope holds for %s', (actorClass) => {
    expect(phishingCampaignSize(actorClass, 4)).toBe(4);
    expect(phishingCampaignSize(actorClass, 10)).toBe(10);
  });

  it('targets a share of the workforce for a ransomware operator, from a floor of 10 people', () => {
    expect(phishingCampaignSize('ransomware_operator', 1000)).toBe(300);
    expect(phishingCampaignSize('ransomware_operator', 60)).toBe(18);
    expect(phishingCampaignSize('ransomware_operator', 20)).toBe(10);
    expect(phishingCampaignSize('ransomware_operator', 33)).toBeCloseTo(10, 12);
    expect(phishingCampaignSize('ransomware_operator', 34)).toBeCloseTo(10.2, 12);
  });

  it('never targets more people than the scope holds for a ransomware operator', () => {
    expect(phishingCampaignSize('ransomware_operator', 7)).toBe(7);
    expect(phishingCampaignSize('ransomware_operator', 1)).toBe(1);
  });

  it('targets a small share of the workforce for opportunistic crime, from a floor of one person', () => {
    expect(phishingCampaignSize('opportunistic_crime', 5000)).toBe(50);
    expect(phishingCampaignSize('opportunistic_crime', 60)).toBe(1);
    expect(phishingCampaignSize('opportunistic_crime', 1000)).toBe(10);
    expect(phishingCampaignSize('opportunistic_crime', 1)).toBe(1);
  });

  it('keeps the fractional size a share gives, without rounding it', () => {
    expect(phishingCampaignSize('opportunistic_crime', 250)).toBe(2.5);
  });

  it.each(ACTOR_CLASS_VALUES)('targets nobody when the scope holds no person, for %s', (actorClass) => {
    expect(phishingCampaignSize(actorClass, 0)).toBe(0);
    expect(phishingCampaignSize(actorClass, -3)).toBe(0);
  });
});
