import type { DoorOpening } from './attack-run-door';
import type { PHISHING_CONSTANTS } from './attack-run-constants';

export interface PhishingPerson {
  readonly target: boolean,
  /** The devices whose primary user is the person, with their openings on T1566: none for a device that carries no flaw. */
  readonly devices: ReadonlyArray<{ readonly family: number, readonly openings: ReadonlyArray<DoorOpening> }>,
}

export interface PhishingDoor {
  /** Index in `DoorEstate.families` of the family people are counted in, identity. */
  readonly personFamily: number,
  /** Index in `DoorEstate.families` of the family a person the door does not list is read on, for the unknown flaw floor and the payload controls: host, -1 when the estate holds no such family. */
  readonly deviceFamily: number,
  readonly people: number,
  readonly targetPeople: number,
  /** Only a person with at least one device carrying an opening is listed; the caller keeps listed targets and others within their counts. */
  readonly persons: ReadonlyArray<PhishingPerson>,
  /**
   * The people paired with devices, none of which carries an opening, grouped by the door families of
   * those devices (sorted, distinct) and by target. Together with `persons` they stay within `people`
   * and `targetPeople`; a person in neither reads `deviceFamily`.
   */
  readonly cleanPersons: ReadonlyArray<{ readonly families: ReadonlyArray<number>, readonly target: boolean, readonly count: number }>,
}

export interface PhishingWorld {
  readonly exploited: (cve: number) => boolean,
  readonly floorHeld: (family: number) => boolean,
  /** Share of the campaign's emails the delivery controls let through. */
  readonly delivery: number,
  /** Share of the credential branch the identity controls let through. */
  readonly credential: number,
  /**
   * Share of the payload branch the controls protecting a family of the door estate let through, -1
   * naming none. A person reads the family of each of their devices, and one the door does not list
   * reads {@link PhishingDoor.deviceFamily}.
   */
  readonly payload: (family: number) => number,
  /** The chance a delivered email gets the person to act, with no training counted. */
  readonly susceptibility: number,
  readonly campaignSize: number,
  readonly cap: number,
}

/** `log(1 - p)`, which is `-Infinity` rather than NaN at `p = 1`. */
const logMiss = (probability: number): number => Math.log1p(-probability);

/**
 * P(at least one email gets a person to act), for the target people and for the others.
 *
 * A person falls to one email with `q = min(cap, L x s x [c x B_cred + (1 - c) x B_exec x
 * ((1 - kappa) + kappa x o)])`, `o` being the chance the person's device opens the payload through a
 * flaw: 1 when the world draws the unknown flaw floor of the device's family, else
 * `1 - PROD(1 - opening)` over the exploits drawn. `B_exec` is the payload let-through of that same
 * family, so a person reads each device on the controls of the device's family and counts for the
 * one that favours the attacker most, a flawless device reading `o = 0` unless its floor is drawn.
 * A person paired with no device reads `deviceFamily` alone, floor and controls.
 *
 * Each group receives `n x group / people` emails, each landing on a person of the group at the
 * group's mean `q`, closed in log space like the door. The chances are summed in sorted order so the
 * order of the people cannot move a bit. The two groups recompose the whole campaign exactly only
 * when they share one mean `q`; with no target, `other` is the whole campaign to the bit.
 */
export const phishingPass = (
  door: PhishingDoor,
  world: PhishingWorld,
  constants: typeof PHISHING_CONSTANTS,
): { target: number, other: number } => {
  const people = door.people;
  if (people <= 0 || world.campaignSize <= 0) {
    return { target: 0, other: 0 };
  }

  const chance = (open: number, payload: number): number => {
    const exposed = payload * ((1 - constants.clientExploitShare) + constants.clientExploitShare * open);
    const branches = constants.credentialShare * world.credential + (1 - constants.credentialShare) * exposed;
    return Math.min(world.cap, Math.max(0, world.delivery * world.susceptibility * branches));
  };

  const unlisted = chance(door.deviceFamily >= 0 && world.floorHeld(door.deviceFamily) ? 1 : 0, world.payload(door.deviceFamily));
  const chanceOfDevices = (devices: PhishingPerson['devices']): number => {
    let best = 0;
    for (const entry of devices) {
      if (best >= world.cap) {
        break;
      }
      let open = 1;
      if (!world.floorHeld(entry.family)) {
        let missLog = 0;
        for (const one of entry.openings) {
          if (one.opening > 0 && world.exploited(one.cve)) {
            missLog += logMiss(Math.min(1, one.opening));
          }
        }
        open = Math.min(1, Math.max(0, -Math.expm1(missLog)));
      }
      best = Math.max(best, chance(open, world.payload(entry.family)));
    }
    return best;
  };

  const targetPeople = Math.min(people, Math.max(0, door.targetPeople));
  const otherPeople = people - targetPeople;
  const targetChances: Array<number> = [];
  const otherChances: Array<number> = [];
  for (const listed of door.persons) {
    (listed.target ? targetChances : otherChances).push(listed.devices.length === 0 ? unlisted : chanceOfDevices(listed.devices));
  }

  // A group reading what an unlisted person reads is left to the remainder, so that adding it
  // changes no bit of the sum.
  const groupsOf = (target: boolean): Array<{ chance: number, count: number }> => door.cleanPersons
    .filter((group) => group.target === target && group.count > 0 && group.families.length > 0)
    .map((group) => ({ chance: chanceOfDevices(group.families.map((family) => ({ family, openings: [] }))), count: group.count }))
    .filter((group) => group.chance !== unlisted)
    .sort((left, right) => (left.chance - right.chance) || (left.count - right.count));

  const passOf = (chances: Array<number>, groups: Array<{ chance: number, count: number }>, count: number): number => {
    if (count <= 0) {
      return 0;
    }
    chances.sort((left, right) => left - right);
    let total = 0;
    for (const value of chances) {
      total += value;
    }
    let room = Math.max(0, count - chances.length);
    for (const group of groups) {
      const taken = Math.min(group.count, room);
      total += taken * group.chance;
      room -= taken;
    }
    total += room * unlisted;
    const mean = Math.min(1, total / count);
    return Math.min(1, Math.max(0, -Math.expm1(world.campaignSize * (count / people) * logMiss(mean))));
  };

  return { target: passOf(targetChances, groupsOf(true), targetPeople), other: passOf(otherChances, groupsOf(false), otherPeople) };
};

/**
 * The share of an untrained population that acts on an email. A rate the tenant declares was
 * measured under the training declared today, so the training is backed out of it and the engine
 * applies it again at delivery; with the training at its declared posture the declared rate comes
 * back. Without a declared rate the default stands.
 */
export const phishingSusceptibility = (declared: number | null, trainingLetThrough: number, defaultSusceptibility: number): number => {
  if (declared === null) {
    return defaultSusceptibility;
  }
  if (declared <= 0) {
    return 0;
  }
  return trainingLetThrough > 0 ? Math.min(1, declared / trainingLetThrough) : 1;
};
