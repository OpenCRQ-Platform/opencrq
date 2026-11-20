import { describe, expect, it } from 'vitest';
import type { DoorOpening } from './attack-run-door';
import type { PhishingDoor, PhishingPerson, PhishingWorld } from './attack-run-phishing';
import { PHISHING_CONSTANTS } from './attack-run-constants';
import { phishingPass } from './attack-run-phishing';

/**
 * The phishing entry as a pure function of the people and one world, asserted on the closed forms
 * it promises. Fixtures below name only what a case varies.
 */

const PERSON_FAMILY = 0;
const HOST = 1;
const MOBILE = 2;

const S = 0.07;
const C = PHISHING_CONSTANTS.credentialShare;
const K = PHISHING_CONSTANTS.clientExploitShare;

const opening = (cve: number, value: number): DoorOpening => ({ cve, technique: 0, opening: value });

const device = (family: number, ...openings: Array<DoorOpening>): PhishingPerson['devices'][number] => ({ family, openings });

const person = (target: boolean, ...devices: Array<PhishingPerson['devices'][number]>): PhishingPerson => ({ target, devices });

const doorOf = (over: Partial<PhishingDoor> & { readonly people: number }): PhishingDoor => ({
  personFamily: PERSON_FAMILY,
  deviceFamily: HOST,
  targetPeople: 0,
  persons: [],
  cleanPersons: [],
  ...over,
});

const worldOf = (over: Partial<Omit<PhishingWorld, 'exploited' | 'floorHeld' | 'payload'>> & {
  readonly exploited?: ReadonlyArray<number>,
  readonly floorHeld?: ReadonlyArray<number>,
  /** One share for every family, or the share each family reads. */
  readonly payload?: number | ((family: number) => number),
} = {}): PhishingWorld => {
  const exploited = new Set(over.exploited ?? []);
  const held = new Set(over.floorHeld ?? []);
  const payload = over.payload ?? 1;
  return {
    exploited: (cve) => exploited.has(cve),
    floorHeld: (family) => held.has(family),
    delivery: over.delivery ?? 1,
    credential: over.credential ?? 1,
    payload: typeof payload === 'function' ? payload : () => payload,
    susceptibility: over.susceptibility ?? S,
    campaignSize: over.campaignSize ?? 10,
    cap: over.cap ?? 0.98,
  };
};

interface Stages {
  readonly delivery: number,
  readonly credential: number,
  readonly payload: number,
  readonly s: number,
}

const STAGES: Stages = { delivery: 1, credential: 1, payload: 1, s: S };

/** One person's chance of falling to one email, before the cap, as section 1 of the doctrine writes it. */
const qOf = (stages: Stages, o: number): number =>
  stages.delivery * stages.s * (C * stages.credential + (1 - C) * stages.payload * ((1 - K) + K * o));

/** `P(at least one of k emails lands)` at a mean chance `q` each. */
const entryOf = (q: number, k: number): number => 1 - (1 - q) ** k;

const reversed = <T>(items: ReadonlyArray<T>): Array<T> => [...items].reverse();

describe('phishingPass', () => {
  it('is 1 - (1 - s x (c + (1 - c)(1 - kappa)))^n with no control, no flaw and no floor', () => {
    const pass = phishingPass(doorOf({ people: 100 }), worldOf({ campaignSize: 10 }), PHISHING_CONSTANTS);
    expect(pass.other).toBeCloseTo(entryOf(S * (C + (1 - C) * (1 - K)), 10), 12);
    expect(pass.target).toBe(0);
  });

  describe('the flaws of a person\'s device', () => {
    const stages: Stages = { delivery: 0.5, credential: 0.3, payload: 0.8, s: S };
    const world = (exploited: ReadonlyArray<number>): PhishingWorld => worldOf({
      exploited, delivery: stages.delivery, credential: stages.credential, payload: stages.payload, campaignSize: 4,
    });
    const people = 10;
    const baseline = entryOf(qOf(stages, 0), 4);

    it('raise the entry by the one person\'s share of the kappa term, and by at most the kappa term of everyone', () => {
      const door = doorOf({ people, persons: [person(false, device(HOST, opening(0, 1)))] });
      const pass = phishingPass(door, world([0]), PHISHING_CONSTANTS);

      const mean = (9 * qOf(stages, 0) + qOf(stages, 1)) / 10;
      expect(pass.other).toBeCloseTo(entryOf(mean, 4), 12);
      expect(pass.other).toBeGreaterThan(baseline);

      const kappaTerm = stages.delivery * S * (1 - C) * stages.payload * K;
      expect(qOf(stages, 1) - qOf(stages, 0)).toBeCloseTo(kappaTerm, 12);
      expect(pass.other - baseline).toBeLessThanOrEqual(entryOf(qOf(stages, 0) + kappaTerm, 4) - baseline + 1e-12);
    });

    it('leave the entry where it is while the exploit is not drawn', () => {
      const door = doorOf({ people, persons: [person(false, device(HOST, opening(0, 1)))] });
      expect(phishingPass(door, world([]), PHISHING_CONSTANTS).other).toBeCloseTo(baseline, 12);
    });

    it('pool as 1 - PROD(1 - opening) on one device, and the person reads the most open of its devices', () => {
      const pooled = doorOf({ people: 1, persons: [person(false, device(HOST, opening(0, 0.5), opening(1, 0.5)))] });
      expect(phishingPass(pooled, world([0, 1]), PHISHING_CONSTANTS).other)
        .toBeCloseTo(entryOf(qOf(stages, 0.75), 4), 12);

      const twoDevices = doorOf({ people: 1, persons: [person(false, device(HOST, opening(0, 0.3)), device(HOST, opening(1, 0.6)))] });
      expect(phishingPass(twoDevices, world([0, 1]), PHISHING_CONSTANTS).other)
        .toBeCloseTo(entryOf(qOf(stages, 0.6), 4), 12);
    });

    it('change nothing for a person the door does not list, whatever circulates and whichever family the floor is drawn on', () => {
      const door = doorOf({ people });
      const quiet = phishingPass(door, world([]), PHISHING_CONSTANTS);
      const loud = phishingPass(door, worldOf({
        exploited: [0, 1, 2], floorHeld: [PERSON_FAMILY], delivery: stages.delivery, credential: stages.credential, payload: stages.payload, campaignSize: 4,
      }), PHISHING_CONSTANTS);
      expect(loud).toEqual(quiet);
      expect(quiet.other).toBeCloseTo(baseline, 12);
    });
  });

  it('falls strictly when the delivery controls let less through, down to 0 when none lets anything', () => {
    const door = doorOf({ people: 100 });
    const entry = (delivery: number): number => phishingPass(door, worldOf({ delivery }), PHISHING_CONSTANTS).other;
    expect(entry(0.5)).toBeLessThan(entry(1));
    expect(entry(0.2)).toBeLessThan(entry(0.5));
    expect(entry(0.5)).toBeCloseTo(entryOf(0.5 * S * (C + (1 - C) * (1 - K)), 10), 12);
    expect(entry(0)).toBe(0);
  });

  it('falls with the credential controls by at most the credential share', () => {
    const door = doorOf({ people: 100 });
    const entry = (credential: number): number => phishingPass(door, worldOf({ credential }), PHISHING_CONSTANTS).other;
    expect(entry(0.5)).toBeLessThan(entry(1));
    expect(entry(0)).toBeLessThan(entry(0.5));
    expect(entry(0)).toBeCloseTo(entryOf(S * (1 - C) * (1 - K), 10), 12);
    expect(entry(0)).toBeGreaterThan(0);
    const whole = S * (C + (1 - C) * (1 - K));
    expect(entry(1) - entry(0)).toBeLessThanOrEqual(entryOf(whole, 10) - entryOf(whole - S * C, 10) + 1e-12);
  });

  it('falls with the payload controls by at most the payload share, whatever the flaws and the floor', () => {
    const door = doorOf({ people: 10, persons: [person(false, device(HOST, opening(0, 1)))] });
    const entry = (payload: number, floorHeld: ReadonlyArray<number>): number =>
      phishingPass(door, worldOf({ payload, exploited: [0], floorHeld }), PHISHING_CONSTANTS).other;
    for (const floorHeld of [[], [HOST]]) {
      expect(entry(0.5, floorHeld)).toBeLessThan(entry(1, floorHeld));
      expect(entry(0, floorHeld)).toBeCloseTo(entryOf(S * C, 10), 12);
      expect(entry(0, floorHeld)).toBeGreaterThan(0);
    }
  });

  describe('in the number of emails and in the susceptibility', () => {
    const door = doorOf({ people: 5000 });

    it('rises with the campaign size', () => {
      const entries = [1, 5, 10, 50, 300].map((campaignSize) => phishingPass(door, worldOf({ campaignSize }), PHISHING_CONSTANTS).other);
      entries.slice(1).forEach((entry, index) => expect(entry).toBeGreaterThan(entries[index]));
    });

    it('rises with the susceptibility', () => {
      const entries = [0.01, 0.07, 0.3].map((susceptibility) => phishingPass(door, worldOf({ susceptibility }), PHISHING_CONSTANTS).other);
      entries.slice(1).forEach((entry, index) => expect(entry).toBeGreaterThan(entries[index]));
    });

    it('does not saturate on a large campaign through strong delivery controls', () => {
      const pass = phishingPass(door, worldOf({ campaignSize: 300, susceptibility: 0.07, delivery: 0.05 }), PHISHING_CONSTANTS);
      expect(pass.other).toBeLessThan(0.7);
      expect(pass.other).toBeGreaterThan(0.5);
    });
  });

  describe('split between the target people and the others', () => {
    it('recomposes the entry of the same people with no flag, whichever of them are targets, while the two groups read one chance', () => {
      for (const floorHeld of [[], [HOST]]) {
        const world = worldOf({ floorHeld, delivery: 0.6, campaignSize: 7 });
        const whole = phishingPass(doorOf({ people: 20 }), world, PHISHING_CONSTANTS).other;
        expect(whole).toBeGreaterThan(0);
        for (const targetPeople of [0, 1, 7, 20]) {
          const pass = phishingPass(doorOf({ people: 20, targetPeople }), world, PHISHING_CONSTANTS);
          expect(pass.target + (1 - pass.target) * pass.other).toBeCloseTo(whole, 12);
        }
      }
    });

    it('reads each group at its own mean chance over its own share of the emails', () => {
      const stages: Stages = { delivery: 0.8, credential: 0.5, payload: 0.9, s: S };
      const door = doorOf({
        people: 20,
        targetPeople: 5,
        persons: [
          person(true, device(HOST, opening(0, 0.6))),
          person(true, device(HOST, opening(1, 1))),
          person(false, device(HOST, opening(0, 0.2))),
        ],
      });
      const world = worldOf({ exploited: [0, 1], delivery: 0.8, credential: 0.5, payload: 0.9, campaignSize: 8 });
      const pass = phishingPass(door, world, PHISHING_CONSTANTS);

      const targetMean = (qOf(stages, 0.6) + qOf(stages, 1) + 3 * qOf(stages, 0)) / 5;
      const otherMean = (qOf(stages, 0.2) + 14 * qOf(stages, 0)) / 15;
      expect(pass.target).toBeCloseTo(entryOf(targetMean, 8 * 5 / 20), 12);
      expect(pass.other).toBeCloseTo(entryOf(otherMean, 8 * 15 / 20), 12);
    });

    it('gives target 0 and the whole entry to other, bit for bit, when no person is a target', () => {
      const constants = { ...PHISHING_CONSTANTS, credentialShare: 0.5, clientExploitShare: 0.25 };
      const door = doorOf({ people: 4, persons: [person(false, device(HOST, opening(0, 0.5)))] });
      const world = worldOf({ exploited: [0], susceptibility: 0.5, campaignSize: 4 });
      const pass = phishingPass(door, world, constants);

      // Every figure here is a dyadic fraction, so the mean 1.78125 / 4 is exact.
      expect(pass.target).toBe(0);
      expect(pass.other).toBe(-Math.expm1(4 * Math.log1p(-0.4453125)));
    });

    it('gives other 0 when every person is a target', () => {
      const pass = phishingPass(doorOf({ people: 6, targetPeople: 6 }), worldOf(), PHISHING_CONSTANTS);
      expect(pass.other).toBe(0);
      expect(pass.target).toBeGreaterThan(0);
      expect(pass.target).toBeCloseTo(entryOf(S * (C + (1 - C) * (1 - K)), 10), 12);
    });
  });

  describe('the cap', () => {
    it('bounds the chance of every person, not the mean', () => {
      const constants = { ...PHISHING_CONSTANTS, credentialShare: 0.5, clientExploitShare: 0.25 };
      const stages: Stages = { delivery: 1, credential: 1, payload: 1, s: 0.5 };
      const qWith = (o: number): number => stages.s * (0.5 + 0.5 * ((0.75) + 0.25 * o));
      expect(qWith(1)).toBeGreaterThan(0.48);
      expect(qWith(0)).toBeLessThan(0.48);

      const door = doorOf({ people: 4, persons: [person(false, device(HOST, opening(0, 1)))] });
      const pass = phishingPass(door, worldOf({ exploited: [0], susceptibility: 0.5, campaignSize: 4, cap: 0.48 }), constants);
      expect(pass.other).toBeCloseTo(entryOf((0.48 + 3 * qWith(0)) / 4, 4), 12);
    });

    it('holds a population at the cap when every person is open and the chance is above it', () => {
      const door = doorOf({ people: 10 });
      const pass = phishingPass(door, worldOf({ floorHeld: [HOST], susceptibility: 1, cap: 0.1, campaignSize: 6 }), PHISHING_CONSTANTS);
      expect(pass.other).toBeCloseTo(entryOf(0.1, 6), 12);
    });
  });

  describe('the unknown flaw floor', () => {
    const stages: Stages = { ...STAGES, delivery: 0.5 };
    const world = (floorHeld: ReadonlyArray<number>): PhishingWorld => worldOf({ floorHeld, delivery: 0.5, campaignSize: 4 });

    it('opens the payload of every person the door does not list when the device family holds it', () => {
      const pass = phishingPass(doorOf({ people: 10 }), world([HOST]), PHISHING_CONSTANTS);
      expect(pass.other).toBeCloseTo(entryOf(qOf(stages, 1), 4), 12);
    });

    it('does not read the family people are counted in', () => {
      const pass = phishingPass(doorOf({ people: 10 }), world([PERSON_FAMILY]), PHISHING_CONSTANTS);
      expect(pass.other).toBeCloseTo(entryOf(qOf(stages, 0), 4), 12);
    });

    it('opens a listed person\'s device on the floor of its own family, never on the floor of another', () => {
      const door = doorOf({ people: 4, persons: [person(false, device(MOBILE, opening(0, 0.1)))] });
      const held = phishingPass(door, world([HOST]), PHISHING_CONSTANTS).other;
      expect(held).toBeCloseTo(entryOf((qOf(stages, 0) + 3 * qOf(stages, 1)) / 4, 4), 12);

      const onItsOwnFamily = phishingPass(door, worldOf({ floorHeld: [MOBILE], exploited: [0], delivery: 0.5, campaignSize: 4 }), PHISHING_CONSTANTS).other;
      expect(onItsOwnFamily).toBeCloseTo(entryOf((qOf(stages, 1) + 3 * qOf(stages, 0)) / 4, 4), 12);
    });
  });

  describe('with nobody or no email', () => {
    it('is 0 for no person, whatever the campaign', () => {
      expect(phishingPass(doorOf({ people: 0 }), worldOf({ floorHeld: [HOST] }), PHISHING_CONSTANTS)).toEqual({ target: 0, other: 0 });
    });

    it('is 0 for an empty campaign', () => {
      const door = doorOf({ people: 10, targetPeople: 4 });
      expect(phishingPass(door, worldOf({ campaignSize: 0, floorHeld: [HOST] }), PHISHING_CONSTANTS)).toEqual({ target: 0, other: 0 });
    });
  });

  describe('independence from the order of what it is given', () => {
    const persons = [
      person(true, device(HOST, opening(0, 0.4), opening(1, 0.3)), device(MOBILE, opening(2, 0.7))),
      person(false, device(HOST, opening(1, 0.5))),
      person(true, device(HOST, opening(2, 0.2))),
      person(false, device(MOBILE, opening(0, 0.9), opening(2, 0.1)), device(HOST, opening(1, 0.6))),
      person(false, device(HOST, opening(0, 0.35))),
    ];
    const door = doorOf({ people: 40, targetPeople: 9, persons });
    const world = worldOf({ exploited: [0, 1, 2], delivery: 0.7, credential: 0.6, payload: 0.8, campaignSize: 12 });
    const reference = phishingPass(door, world, PHISHING_CONSTANTS);

    it('gives the same bits whatever the order of the people and of their devices', () => {
      expect(reference.other).toBeGreaterThan(0);
      expect(phishingPass(doorOf({ ...door, persons: reversed(persons) }), world, PHISHING_CONSTANTS)).toEqual(reference);
      const devicesReversed = persons.map((one) => person(one.target, ...reversed(one.devices)));
      expect(phishingPass(doorOf({ ...door, persons: devicesReversed }), world, PHISHING_CONSTANTS)).toEqual(reference);
      const rotated = [...persons.slice(2), ...persons.slice(0, 2)];
      expect(phishingPass(doorOf({ ...door, persons: rotated }), world, PHISHING_CONSTANTS)).toEqual(reference);
    });

    it('gives the same figures whatever the order of the openings of a device', () => {
      const shuffledOpenings = persons.map((one) => person(one.target, ...one.devices.map((entry) => device(entry.family, ...reversed(entry.openings)))));
      const pass = phishingPass(doorOf({ ...door, persons: shuffledOpenings }), world, PHISHING_CONSTANTS);
      expect(pass.target).toBeCloseTo(reference.target, 12);
      expect(pass.other).toBeCloseTo(reference.other, 12);
      expect(reference.target).toBeGreaterThan(0);
    });
  });
});
