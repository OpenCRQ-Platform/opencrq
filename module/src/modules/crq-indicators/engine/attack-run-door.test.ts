import { describe, expect, it } from 'vitest';
import type { DoorAsset, DoorEstate, DoorOpening, DoorPass, DoorWorld } from './attack-run-door';
import { ACTOR_CLASS_PRESETS } from '../../threat-analyses/actor-classes';
import { ASSET_CATEGORY_VALUES } from '../../supporting-assets/constants';
import { ATTACK_RUN_CONSTANTS } from './attack-run-constants';
import { doorPassByTechnique, unknownFlawFloor } from './attack-run-door';

/**
 * The door's law as a pure function of the estate and one world, asserted on the closed forms it
 * promises. Fixtures below name only what a case varies.
 */

const CAP = 0.98;

const opening = (cve: number, technique: number, value: number): DoorOpening => ({ cve, technique, opening: value });

const asset = (family: number, ...openings: Array<DoorOpening>): DoorAsset => ({ family, openings, target: false });

const targetAsset = (family: number, ...openings: Array<DoorOpening>): DoorAsset => ({ ...asset(family, ...openings), target: true });

const estateOf = (over: {
  readonly techniques?: number,
  readonly cves?: number,
  readonly assets?: ReadonlyArray<DoorAsset>,
  readonly applicable: ReadonlyArray<ReadonlyArray<number>>,
  readonly targetApplicable?: ReadonlyArray<ReadonlyArray<number>>,
}): DoorEstate => ({
  techniques: Array.from({ length: over.techniques ?? over.applicable.length }, (_, index) => `T${1000 + index}`),
  families: ASSET_CATEGORY_VALUES.slice(0, over.applicable.reduce((most, row) => Math.max(most, row.length), 0)),
  cves: Array.from({ length: over.cves ?? 0 }, (_, index) => ({ cveId: `CVE-2024-${index}`, threat: 0.5, priced: true })),
  assets: over.assets ?? [],
  applicable: over.applicable.map((row) => Float64Array.from(row)),
  targetApplicable: (over.targetApplicable ?? over.applicable.map((row) => row.map(() => 0))).map((row) => Float64Array.from(row)),
  phishing: null,
});

/** The whole door per technique, written so that with no target it is `other` to the bit, as the engine's `D_O` reads it. */
const wholeDoorPass = (pass: DoorPass): Float64Array =>
  pass.target.map((target, technique) => Math.min(1, target + pass.other[technique] * (1 - target)));

const passOf = (estate: DoorEstate, world: DoorWorld): Float64Array => wholeDoorPass(doorPassByTechnique(estate, world));

const worldOf = (over: Partial<{
  readonly exploited: ReadonlyArray<number>,
  readonly floorHeld: ReadonlyArray<number>,
  readonly letThrough: number | ReadonlyArray<ReadonlyArray<number>>,
  readonly cap: number,
}> = {}): DoorWorld => {
  const exploited = new Set(over.exploited ?? []);
  const held = new Set(over.floorHeld ?? []);
  const letThrough = over.letThrough ?? 1;
  return {
    exploited: (cve) => exploited.has(cve),
    floorHeld: (family) => held.has(family),
    letThrough: (technique, family) => (typeof letThrough === 'number' ? letThrough : letThrough[technique][family]),
    cap: over.cap ?? CAP,
  };
};

describe('doorPassByTechnique', () => {
  it('gives 0 to a technique no asset can be attacked by, whatever the world holds', () => {
    const estate = estateOf({ applicable: [[0, 0], [3, 2]], cves: 1 });
    const pass = passOf(estate, worldOf({ exploited: [0], floorHeld: [0, 1] }));
    expect(pass[0]).toBe(0);
    expect(pass[1]).toBeGreaterThan(0);
  });

  it('lets no asset fall through a flaw whose exploit is not drawn, and exposes every asset carrying it once it is', () => {
    const carriers = Array.from({ length: 4 }, () => asset(0, opening(0, 0, 0.5)));
    const estate = estateOf({ applicable: [[10]], cves: 1, assets: carriers });
    const world = { letThrough: 0.8 };

    expect(passOf(estate, worldOf(world))[0]).toBe(0);

    const each = 0.8 * 0.5;
    expect(passOf(estate, worldOf({ ...world, exploited: [0] }))[0]).toBeCloseTo(1 - (1 - each) ** 4, 12);
  });

  it('raises the fall of an asset with a second opening on the same technique', () => {
    const one = estateOf({ applicable: [[1]], cves: 2, assets: [asset(0, opening(0, 0, 0.3))] });
    const two = estateOf({ applicable: [[1]], cves: 2, assets: [asset(0, opening(0, 0, 0.3), opening(1, 0, 0.3))] });
    const world = worldOf({ exploited: [0, 1], letThrough: 0.9 });
    const single = passOf(one, world)[0];
    const double = passOf(two, world)[0];
    expect(single).toBeCloseTo(0.9 * 0.3, 12);
    expect(double).toBeCloseTo(0.9 * (1 - 0.7 * 0.7), 12);
    expect(double).toBeGreaterThan(single);
  });

  it('ignores a second opening whose exploit is not drawn', () => {
    const estate = estateOf({ applicable: [[1]], cves: 2, assets: [asset(0, opening(0, 0, 0.3), opening(1, 0, 0.9))] });
    expect(passOf(estate, worldOf({ exploited: [0] }))[0]).toBeCloseTo(0.3, 12);
  });

  it('reads an opening on one technique only on that technique', () => {
    const estate = estateOf({ applicable: [[2], [2]], cves: 1, assets: [asset(0, opening(0, 1, 0.5))] });
    const pass = passOf(estate, worldOf({ exploited: [0] }));
    expect(pass[0]).toBe(0);
    expect(pass[1]).toBeCloseTo(0.5, 12);
  });

  describe('with no opening at all', () => {
    const estate = estateOf({ applicable: [[3, 2]] });

    it('is 0 while the floor is not drawn for any family', () => {
      expect(passOf(estate, worldOf({ letThrough: 0.7 }))[0]).toBe(0);
    });

    it('never exceeds 1 - (1 - min(cap, LT))^N, and reaches it when the floor is drawn everywhere', () => {
      const bound = (letThrough: number): number => 1 - (1 - Math.min(CAP, letThrough)) ** 5;
      for (const letThrough of [0.1, 0.5, 0.98, 1]) {
        const world = (floorHeld: ReadonlyArray<number>): DoorWorld => worldOf({ letThrough, floorHeld });
        expect(passOf(estate, world([0]))[0]).toBeLessThanOrEqual(bound(letThrough) + 1e-15);
        expect(passOf(estate, world([1]))[0]).toBeLessThanOrEqual(bound(letThrough) + 1e-15);
        expect(passOf(estate, world([0, 1]))[0]).toBeCloseTo(bound(letThrough), 12);
      }
    });

    it('counts only the families whose floor is drawn', () => {
      expect(passOf(estate, worldOf({ letThrough: 0.5, floorHeld: [1] }))[0]).toBeCloseTo(1 - 0.5 ** 2, 12);
    });
  });

  it('gives 0 when nothing is let through, floor drawn or not', () => {
    const estate = estateOf({ applicable: [[3]], cves: 1, assets: [asset(0, opening(0, 0, 1))] });
    expect(passOf(estate, worldOf({ letThrough: 0, exploited: [0], floorHeld: [0] }))[0]).toBe(0);
    expect(passOf(estate, worldOf({ letThrough: 0, exploited: [0] }))[0]).toBe(0);
  });

  it('saturates towards 1 under many strong drawn openings, without NaN', () => {
    const assets = Array.from({ length: 2000 }, () => asset(0, opening(0, 0, 1)));
    const estate = estateOf({ applicable: [[2000]], cves: 1, assets });
    const pass = passOf(estate, worldOf({ exploited: [0], letThrough: 1 }))[0];
    expect(Number.isNaN(pass)).toBe(false);
    expect(pass).toBeLessThanOrEqual(1);
    expect(pass).toBeGreaterThan(1 - 1e-12);
  });

  it('caps the fall of one asset at the cap, however strong its openings and LT', () => {
    const estate = estateOf({ applicable: [[1]], cves: 3, assets: [asset(0, opening(0, 0, 1), opening(1, 0, 0.9), opening(2, 0, 0.9))] });
    expect(passOf(estate, worldOf({ exploited: [0, 1, 2], letThrough: 1, cap: 0.6 }))[0]).toBeCloseTo(0.6, 12);
    const floored = estateOf({ applicable: [[1]] });
    expect(passOf(floored, worldOf({ floorHeld: [0], letThrough: 1, cap: 0.6 }))[0]).toBeCloseTo(0.6, 12);
  });

  it('counts an asset with openings once when the floor is drawn for its family', () => {
    const estate = estateOf({ applicable: [[4]], cves: 2, assets: [asset(0, opening(0, 0, 0.9)), asset(0, opening(1, 0, 0.9))] });
    const world = worldOf({ exploited: [0, 1], floorHeld: [0], letThrough: 0.5 });
    expect(passOf(estate, world)[0]).toBeCloseTo(1 - 0.5 ** 4, 12);
  });

  it('prices every technique and family with its own LT', () => {
    const estate = estateOf({ applicable: [[1, 1], [1, 1]] });
    const pass = passOf(estate, worldOf({ floorHeld: [0, 1], letThrough: [[0.2, 0.4], [0, 0.5]] }));
    expect(pass[0]).toBeCloseTo(1 - 0.8 * 0.6, 12);
    expect(pass[1]).toBeCloseTo(0.5, 12);
  });

  it('stays exact on tiny openings where 1 - (1 - x) would round to 0', () => {
    const estate = estateOf({ applicable: [[1]], cves: 1, assets: [asset(0, opening(0, 0, 1e-20))] });
    expect(passOf(estate, worldOf({ exploited: [0] }))[0]).toBeCloseTo(1e-20, 30);
  });

  it('matches the hand-computed campaign over two families, three assets and two CVEs', () => {
    // Technique 0: three assets in family 0 (two with openings), two in family 1 (one with an opening).
    const estate = estateOf({
      applicable: [[3, 2]],
      cves: 2,
      assets: [
        asset(0, opening(0, 0, 0.5)),
        asset(0, opening(0, 0, 0.4), opening(1, 0, 0.5)),
        asset(1, opening(1, 0, 0.8)),
      ],
    });
    const letThrough = [[0.6, 0.5]];

    // CVE 0 drawn, CVE 1 not, no floor: asset 1 falls at 0.6 x 0.5, asset 2 at 0.6 x 0.4, asset 3 not.
    const plain = passOf(estate, worldOf({ exploited: [0], letThrough, cap: 0.9 }))[0];
    expect(plain).toBeCloseTo(1 - (1 - 0.3) * (1 - 0.24), 12);
    expect(plain).toBeCloseTo(0.468, 12);

    // Both drawn, floor on family 1: asset 2 pools 1 - 0.6 x 0.5, family 1's two assets fall at LT = 0.5, asset 3 not twice.
    const floorOnOne = passOf(estate, worldOf({ exploited: [0, 1], floorHeld: [1], letThrough, cap: 0.9 }))[0];
    expect(floorOnOne).toBeCloseTo(1 - (1 - 0.3) * (1 - 0.42) * 0.5 * 0.5, 12);
    expect(floorOnOne).toBeCloseTo(0.8985, 12);

    // Floor on both families: the three assets of family 0 at 0.6, the two of family 1 at 0.5, openings irrelevant.
    const floorOnBoth = passOf(estate, worldOf({ exploited: [0, 1], floorHeld: [0, 1], letThrough, cap: 0.9 }))[0];
    expect(floorOnBoth).toBeCloseTo(1 - 0.4 ** 3 * 0.5 ** 2, 12);
    expect(floorOnBoth).toBeCloseTo(0.984, 12);
  });
});

describe('doorPassByTechnique split between targets and other assets', () => {
  it('gives target 0 everywhere on an estate with no target, and the whole pass equals the other one bit for bit', () => {
    const estate = estateOf({
      applicable: [[3, 2]],
      cves: 2,
      assets: [asset(0, opening(0, 0, 0.5)), asset(0, opening(0, 0, 0.4), opening(1, 0, 0.5)), asset(1, opening(1, 0, 0.8))],
    });
    const world = worldOf({ exploited: [0, 1], floorHeld: [1], letThrough: [[0.6, 0.5]], cap: 0.9 });
    const pass = doorPassByTechnique(estate, world);
    expect(Array.from(pass.target)).toEqual([0]);
    expect(wholeDoorPass(pass)[0]).toBe(pass.other[0]);
    expect(pass.other[0]).toBeCloseTo(0.8985, 12);
  });

  it('keeps the closed forms of the whole door pinned when no asset is a target', () => {
    const estate = estateOf({
      applicable: [[3, 2]],
      cves: 2,
      assets: [asset(0, opening(0, 0, 0.5)), asset(0, opening(0, 0, 0.4), opening(1, 0, 0.5)), asset(1, opening(1, 0, 0.8))],
    });
    const letThrough = [[0.6, 0.5]];
    expect(passOf(estate, worldOf({ exploited: [0], letThrough, cap: 0.9 }))[0]).toBeCloseTo(0.468, 12);
    expect(passOf(estate, worldOf({ exploited: [0, 1], floorHeld: [1], letThrough, cap: 0.9 }))[0]).toBeCloseTo(0.8985, 12);
    expect(passOf(estate, worldOf({ exploited: [0, 1], floorHeld: [0, 1], letThrough, cap: 0.9 }))[0]).toBeCloseTo(0.984, 12);
  });

  it('recomposes the pass of the same assets that carry no flag, whichever of them are targets', () => {
    const openings = [[opening(0, 0, 0.5)], [opening(0, 0, 0.4), opening(1, 0, 0.5)], [opening(1, 0, 0.8)], [opening(0, 0, 0.3)]];
    const families = [0, 0, 1, 1];
    const world = worldOf({ exploited: [0, 1], floorHeld: [], letThrough: [[0.6, 0.5]], cap: 0.9 });
    const flagless = estateOf({ applicable: [[2, 2]], cves: 2, assets: openings.map((rows, index) => asset(families[index], ...rows)) });
    const expected = passOf(flagless, world)[0];

    const split = estateOf({
      applicable: [[2, 2]],
      targetApplicable: [[1, 1]],
      cves: 2,
      assets: openings.map((rows, index) => (index % 2 === 0 ? targetAsset : asset)(families[index], ...rows)),
    });
    const pass = doorPassByTechnique(split, world);
    expect(pass.target[0]).toBeGreaterThan(0);
    expect(pass.other[0]).toBeGreaterThan(0);
    expect(1 - (1 - pass.target[0]) * (1 - pass.other[0])).toBeCloseTo(expected, 12);
    expect(passOf(split, world)[0]).toBeCloseTo(expected, 12);
  });

  it('splits the floor of a family holding 2 targets among 5 assets into 1 - (1 - f)^2 and 1 - (1 - f)^3', () => {
    const estate = estateOf({ applicable: [[5]], targetApplicable: [[2]] });
    const fall = 0.3;
    const pass = doorPassByTechnique(estate, worldOf({ floorHeld: [0], letThrough: fall }));
    expect(pass.target[0]).toBeCloseTo(1 - (1 - fall) ** 2, 12);
    expect(pass.other[0]).toBeCloseTo(1 - (1 - fall) ** 3, 12);
  });

  it('leaves a family with no target to the other pass, and a family of targets only to the target pass', () => {
    const estate = estateOf({ applicable: [[4, 3]], targetApplicable: [[0, 3]] });
    const pass = doorPassByTechnique(estate, worldOf({ floorHeld: [0, 1], letThrough: 0.5 }));
    expect(pass.target[0]).toBeCloseTo(1 - 0.5 ** 3, 12);
    expect(pass.other[0]).toBeCloseTo(1 - 0.5 ** 4, 12);
  });

  it('gives a target a zero pass when the exploit of its only opening is not drawn', () => {
    const estate = estateOf({ applicable: [[1, 2]], targetApplicable: [[1, 0]], cves: 1, assets: [targetAsset(0, opening(0, 0, 0.9))] });
    const pass = doorPassByTechnique(estate, worldOf({ letThrough: 1 }));
    expect(pass.target[0]).toBe(0);
    expect(pass.other[0]).toBe(0);
  });

  it('reads an opening of a target on the target pass only, and one of another asset on the other pass only', () => {
    const estate = estateOf({
      applicable: [[2]],
      targetApplicable: [[1]],
      cves: 2,
      assets: [targetAsset(0, opening(0, 0, 0.5)), asset(0, opening(1, 0, 0.2))],
    });
    const both = doorPassByTechnique(estate, worldOf({ exploited: [0, 1], letThrough: 1 }));
    expect(both.target[0]).toBeCloseTo(0.5, 12);
    expect(both.other[0]).toBeCloseTo(0.2, 12);
    const onlyOther = doorPassByTechnique(estate, worldOf({ exploited: [1], letThrough: 1 }));
    expect(onlyOther.target[0]).toBe(0);
    expect(onlyOther.other[0]).toBeCloseTo(0.2, 12);
  });

  it('counts an asset with openings once on the target pass when the floor is drawn for its family', () => {
    const estate = estateOf({ applicable: [[3]], targetApplicable: [[1]], cves: 1, assets: [targetAsset(0, opening(0, 0, 0.9))] });
    const pass = doorPassByTechnique(estate, worldOf({ exploited: [0], floorHeld: [0], letThrough: 0.5 }));
    expect(pass.target[0]).toBeCloseTo(0.5, 12);
    expect(pass.other[0]).toBeCloseTo(1 - 0.5 ** 2, 12);
  });

  it('caps the fall of a target at the cap', () => {
    const estate = estateOf({ applicable: [[1]], targetApplicable: [[1]], cves: 1, assets: [targetAsset(0, opening(0, 0, 1))] });
    expect(doorPassByTechnique(estate, worldOf({ exploited: [0], letThrough: 1, cap: 0.6 })).target[0]).toBeCloseTo(0.6, 12);
  });
});

describe('unknownFlawFloor', () => {
  it('is 0.04 x the capability of the class', () => {
    expect(ATTACK_RUN_CONSTANTS.unknownFlawFloorScale).toBe(0.04);
    const floors = [
      'opportunistic_crime', 'hacktivist', 'default', 'ransomware_operator', 'state_sponsored',
    ] as const;
    const expected = [0.012, 0.012, 0.02, 0.022, 0.036];
    floors.forEach((name, index) => {
      expect(unknownFlawFloor(ACTOR_CLASS_PRESETS[name].capability, ATTACK_RUN_CONSTANTS.unknownFlawFloorScale)).toBeCloseTo(expected[index], 12);
    });
  });

  it('stays at or below 0.04 for every capability in [0, 1]', () => {
    for (const preset of Object.values(ACTOR_CLASS_PRESETS)) {
      expect(unknownFlawFloor(preset.capability, ATTACK_RUN_CONSTANTS.unknownFlawFloorScale)).toBeLessThanOrEqual(0.04);
    }
    expect(unknownFlawFloor(0, ATTACK_RUN_CONSTANTS.unknownFlawFloorScale)).toBe(0);
    expect(unknownFlawFloor(1, ATTACK_RUN_CONSTANTS.unknownFlawFloorScale)).toBeLessThanOrEqual(0.04);
  });
});
