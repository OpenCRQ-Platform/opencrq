import type { AssetCategory } from '../../supporting-assets/constants';
import type { PhishingDoor } from './attack-run-phishing';

/**
 * The door of the attack run as one campaign over the whole estate, a pure function of the estate
 * and one world: no draw happens here, the world says which exploits circulate and which families
 * hold an unknown flaw.
 */

export interface DoorCve {
  /** The `cve` row id, which keys the CVE's draw. */
  readonly cveId: string,
  /** The probability its exploit circulates, what the world's draw is compared against. */
  readonly threat: number,
  /** Whether the run prices the what-if of fixing it: only a flaw whose threat carries a signal above silence is. */
  readonly priced: boolean,
}

/** What one finding opens on one technique of one asset, in indexes into the estate's `cves` and `techniques`. */
export interface DoorOpening {
  readonly cve: number,
  readonly technique: number,
  readonly opening: number,
}

/** Only an asset carrying at least one opening is listed: the others are counted in `applicable`. */
export interface DoorAsset {
  readonly family: number,
  readonly openings: ReadonlyArray<DoorOpening>,
  /** Whether the asset is one the scenario's primary resources depend on. */
  readonly target: boolean,
}

/** A declared kind each world draws again: where the door counts its virtual assets, none of them a target. */
export interface DoorDeclaredKind {
  readonly kind: string,
  /** Index in `DoorEstate.families`. */
  readonly family: number,
  /** The techniques, by index, whose `applicable` row counts the kind's internal virtual assets. */
  readonly techniques: ReadonlyArray<number>,
  /** Whether the virtual assets are people, which phishing counts in `PhishingDoor.people`. */
  readonly people: boolean,
}

export interface DoorEstate {
  /** Parent techniques, in the order of every per-technique result. */
  readonly techniques: ReadonlyArray<string>,
  /**
   * The asset families, in the order of every per-family index of the door: `DoorAsset.family`, the
   * second axis of `applicable` and `DoorWorld.floorHeld`. The run draws one floor uniform per entry,
   * so these are the `familyIds` its worlds are built from.
   */
  readonly families: ReadonlyArray<AssetCategory>,
  readonly cves: ReadonlyArray<DoorCve>,
  readonly assets: ReadonlyArray<DoorAsset>,
  /** `applicable[t][f]`: the assets of family `f` technique `t` applies to, those carrying an opening included. */
  readonly applicable: ReadonlyArray<Float64Array>,
  /** `targetApplicable[t][f]`: the part of `applicable[t][f]` that is a target, so never above it. */
  readonly targetApplicable: ReadonlyArray<Float64Array>,
  /**
   * What T1566 reads, in place of the per-asset law above: the people of the scope. T1566 stays among
   * `techniques`, with no asset applicable and no opening on any `DoorAsset`. Null when the scope has
   * no person to deliver to.
   */
  readonly phishing: PhishingDoor | null,
  /** The counts above hold each drawn kind at its low bound, which a world moves by its own draw. Absent when no kind is drawn. */
  readonly declared?: ReadonlyArray<DoorDeclaredKind>,
}

export interface DoorWorld {
  readonly exploited: (cve: number) => boolean,
  readonly floorHeld: (family: number) => boolean,
  /** The share of attempts the family's controls let through, already in the prepared world. */
  readonly letThrough: (technique: number, family: number) => number,
  readonly cap: number,
}

/** The unknown flaw floor is a share of the class capability: the top of NIST's very low band at a scale of 0.04. */
export const unknownFlawFloor = (capability: number, scale: number): number => scale * capability;

/** `log(1 - p)`, which is `-Infinity` rather than NaN at `p = 1`. */
const logMiss = (probability: number): number => Math.log1p(-probability);

export interface DoorPass {
  /** Per technique, P(at least one target falls). */
  readonly target: Float64Array,
  /** Per technique, P(at least one asset that is not a target falls). */
  readonly other: Float64Array,
}

/**
 * `P(at least one asset falls)` for every technique of the door, in this world, once for the
 * targets and once for the other assets: assets fall independently within a world, so the two
 * recompose into the whole door.
 *
 * A family whose floor is drawn exposes all its applicable assets, each falling with
 * `min(cap, LT)`. Otherwise only the assets with a drawn exploit on the technique are exposed, each
 * with `min(cap, LT x [1 - PROD(1 - opening)])`. An asset with openings is therefore counted by the
 * floor alone when the floor is drawn, never twice.
 *
 * The products are summed as logarithms and closed with `expm1`: thousands of assets cannot
 * underflow a running product into a wrong 0 or 1, and a probability of 1e-12 keeps its digits
 * where `1 - PROD(...)` would round it away. Cost is linear in the openings plus families x
 * techniques.
 */
export const doorPassByTechnique = (estate: DoorEstate, world: DoorWorld): DoorPass => {
  const techniqueCount = estate.techniques.length;
  const targetLog = new Float64Array(techniqueCount);
  const otherLog = new Float64Array(techniqueCount);
  const familyCount = estate.applicable.reduce((most, row) => Math.max(most, row.length), 0);

  const held = new Uint8Array(familyCount);
  for (let family = 0; family < familyCount; family += 1) {
    held[family] = world.floorHeld(family) ? 1 : 0;
  }

  for (let technique = 0; technique < techniqueCount; technique += 1) {
    const row = estate.applicable[technique];
    const targetRow = estate.targetApplicable[technique];
    for (let family = 0; family < familyCount; family += 1) {
      const count = row[family];
      if (held[family] === 1 && count > 0) {
        const fall = Math.min(world.cap, Math.max(0, world.letThrough(technique, family)));
        if (fall > 0) {
          const miss = logMiss(fall);
          const targets = targetRow[family];
          if (targets > 0) {
            targetLog[technique] += targets * miss;
          }
          if (count > targets) {
            otherLog[technique] += (count - targets) * miss;
          }
        }
      }
    }
  }

  const exploitedByCve = new Int8Array(estate.cves.length);
  const openingLog = new Float64Array(techniqueCount);
  const stamp = new Int32Array(techniqueCount).fill(-1);
  const touched: Array<number> = [];
  estate.assets.forEach((asset, assetIndex) => {
    if (held[asset.family] === 1) {
      return;
    }
    touched.length = 0;
    for (const entry of asset.openings) {
      if (exploitedByCve[entry.cve] === 0) {
        exploitedByCve[entry.cve] = world.exploited(entry.cve) ? 1 : -1;
      }
      if (exploitedByCve[entry.cve] === 1 && entry.opening > 0) {
        if (stamp[entry.technique] !== assetIndex) {
          stamp[entry.technique] = assetIndex;
          openingLog[entry.technique] = 0;
          touched.push(entry.technique);
        }
        openingLog[entry.technique] += logMiss(Math.min(1, entry.opening));
      }
    }
    const missLog = asset.target ? targetLog : otherLog;
    for (const technique of touched) {
      const opened = -Math.expm1(openingLog[technique]);
      const fall = Math.min(world.cap, Math.max(0, world.letThrough(technique, asset.family)) * opened);
      if (fall > 0) {
        missLog[technique] += logMiss(fall);
      }
    }
  });

  const target = new Float64Array(techniqueCount);
  const other = new Float64Array(techniqueCount);
  for (let technique = 0; technique < techniqueCount; technique += 1) {
    target[technique] = Math.min(1, Math.max(0, -Math.expm1(targetLog[technique])));
    other[technique] = Math.min(1, Math.max(0, -Math.expm1(otherLog[technique])));
  }
  return { target, other };
};
