import { compareCodePoints } from '@app/utils';
import type { AssetCategory, AssetSubcategory } from '../supporting-assets/constants';
import type { SupportingAssetExposure } from '../supporting-assets/schema';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { DoorAsset, DoorCve, DoorDeclaredKind, DoorEstate, DoorOpening } from './engine/attack-run-door';
import type { PhishingDoor } from './engine/attack-run-phishing';
import { SILENT_FLAW_THREAT } from '../cve/silent-flaw-threat';
import { entryTechniqueApplies } from '../attack-surfaces/entry-applicability';
import { PHISHING_STAGE_TECHNIQUES } from './engine/attack-run-constants';

/** The estate at the grain the door's applicability rule reads: how many assets carry each tuple. */
export interface DoorCountRow {
  readonly categoryId: AssetCategory,
  readonly subcategoryId: AssetSubcategory | null,
  readonly exposure: SupportingAssetExposure,
  readonly identityEnabled: boolean,
  /** Whether these assets are ones the scenario's primary resources depend on. */
  readonly target: boolean,
  readonly count: number,
  /** The declared kind whose virtual assets these are, when each world draws their count again. */
  readonly declaredKind?: string,
}

/**
 * One finding's stored opening of one initial access technique, with the asset and CVE it belongs
 * to. The asset's subcategory and exposure are the ones read now, not the ones the row was written
 * under, so the run reapplies the applicability rule to them.
 */
export interface EntryOpeningRow {
  readonly supportingAssetId: string,
  readonly categoryId: AssetCategory,
  readonly subcategoryId: AssetSubcategory | null,
  readonly exposure: SupportingAssetExposure,
  /** Whether the asset is one the scenario's primary resources depend on. */
  readonly target: boolean,
  /** The `cve` row id: reading the catalogue for the CVE's name would reprice every scenario on each CVE sync. */
  readonly cveId: string,
  readonly techniqueExternalId: string,
  readonly opening: number,
  readonly threat: number,
}

/** One `primary_user_of` pair: an active user account and a device it is the primary user of. */
export interface PrimaryUserRow {
  readonly identityId: string,
  readonly deviceId: string,
  /** The device's family, which the phishing payload and the unknown flaw floor are read on whether or not the device carries a flaw. */
  readonly deviceCategoryId: AssetCategory,
  /** Whether the account is one the scenario's primary resources depend on. */
  readonly identityTarget: boolean,
}

export interface DoorEstateSource {
  /** The parent techniques some attacker of the run plays at the door. */
  readonly techniqueExternalIds: ReadonlyArray<string>,
  readonly applicableFamiliesByTechnique: ReadonlyMap<string, ReadonlyArray<AssetCategory>>,
  readonly counts: ReadonlyArray<DoorCountRow>,
  readonly openings: ReadonlyArray<EntryOpeningRow>,
  /** Empty when no pair is known: people are then counted, and no device is linked to any of them. */
  readonly primaryUsers: ReadonlyArray<PrimaryUserRow>,
  readonly unknownExposureCountsAs: UnknownExposureCountsAs,
}

const PHISHING_DELIVERY = PHISHING_STAGE_TECHNIQUES.delivery[0];

const parentOf = (techniqueExternalId: string): string => techniqueExternalId.split('.')[0];

/**
 * The door's estate, built once per run and shared by every attacker class.
 *
 * Whatever order the reads returned, the result is the same: the techniques, families, CVEs and
 * assets are sorted, and the only reductions are integer sums and maxima.
 *
 * A family counts for a technique only when the technique families table carries it for some
 * repertoire technique of that parent. Sub-techniques fold to their parent: an asset's opening of
 * a parent is the strongest of its openings of any sub-technique, per CVE. A CVE has one threat per
 * run, and findings recomputed at different moments can disagree on it, so the highest wins.
 *
 * Phishing is read from people, not from assets: T1566 leaves no count in `applicable` and no
 * opening on a `DoorAsset`, and `phishing` carries the people instead. They are the enabled user
 * accounts alone, so an estate with none has no phishing, however many workstations it holds. Each
 * opening of a device is filed under the primary users of that device, so a flaw on a device nobody
 * uses opens nothing. A person
 * paired only with devices that carry no flaw is counted in `cleanPersons`, by the families of those
 * devices and within the people counts, so the family of a device is read whether or not it is flawed.
 */
export const buildDoorEstate = (source: DoorEstateSource): DoorEstate => {
  const techniques = [...new Set(source.techniqueExternalIds.map(parentOf))].sort(compareCodePoints);
  const techniqueIndexOf = new Map(techniques.map((externalId, index) => [externalId, index]));

  const carriedBy = new Map<string, Set<AssetCategory>>();
  for (const [externalId, families] of source.applicableFamiliesByTechnique) {
    const parent = parentOf(externalId);
    if (techniqueIndexOf.has(parent)) {
      const held = carriedBy.get(parent) ?? new Set<AssetCategory>();
      for (const family of families) {
        held.add(family);
      }
      carriedBy.set(parent, held);
    }
  }

  const countByPair = new Map<string, number>();
  const targetCountByPair = new Map<string, number>();
  const familySet = new Set<AssetCategory>();
  const drawnTechniques = new Map<string, { category: AssetCategory, techniques: Array<string> }>();
  for (const row of source.counts) {
    for (const technique of techniques) {
      if (carriedBy.get(technique)?.has(row.categoryId) === true
        && entryTechniqueApplies(technique, row, source.unknownExposureCountsAs)) {
        if (technique !== PHISHING_DELIVERY) {
          const pair = `${technique}|${row.categoryId}`;
          countByPair.set(pair, (countByPair.get(pair) ?? 0) + row.count);
          if (row.target) {
            targetCountByPair.set(pair, (targetCountByPair.get(pair) ?? 0) + row.count);
          }
          if (row.declaredKind !== undefined) {
            const held = drawnTechniques.get(row.declaredKind) ?? { category: row.categoryId, techniques: [] };
            held.techniques.push(technique);
            drawnTechniques.set(row.declaredKind, held);
          }
        }
        familySet.add(row.categoryId);
      }
    }
  }

  const people = { accounts: 0, targetAccounts: 0 };
  let drawnPeople: string | null = null;
  for (const row of source.counts) {
    if (row.categoryId === 'identity' && techniqueIndexOf.has(PHISHING_DELIVERY)
      && carriedBy.get(PHISHING_DELIVERY)?.has(row.categoryId) === true
      && entryTechniqueApplies(PHISHING_DELIVERY, row, source.unknownExposureCountsAs)) {
      people.accounts += row.count;
      people.targetAccounts += row.target ? row.count : 0;
      drawnPeople = row.declaredKind ?? drawnPeople;
    }
  }

  const strongest = new Map<string, EntryOpeningRow & { techniqueExternalId: string }>();
  const deviceFlaws = new Map<string, EntryOpeningRow & { techniqueExternalId: string }>();
  const deviceCategory = new Map<string, AssetCategory>();
  const targetAssetIds = new Set<string>();
  const threatOf = new Map<string, number>();
  for (const row of source.openings) {
    const technique = parentOf(row.techniqueExternalId);
    // A finding sits on an asset, never on an identity, so no identity is ever disabled here.
    if (!techniqueIndexOf.has(technique) || !(row.opening > 0) || carriedBy.get(technique)?.has(row.categoryId) !== true
      || !entryTechniqueApplies(technique, { ...row, identityEnabled: true }, source.unknownExposureCountsAs)) {
      continue;
    }
    const phishing = technique === PHISHING_DELIVERY;
    if (row.target && !phishing) {
      targetAssetIds.add(row.supportingAssetId);
    }
    const key = `${row.supportingAssetId}|${row.cveId}|${technique}`;
    const flaws = phishing ? deviceFlaws : strongest;
    const held = flaws.get(key);
    if (held === undefined || row.opening > held.opening) {
      flaws.set(key, { ...row, techniqueExternalId: technique });
    }
    if (phishing) {
      deviceCategory.set(row.supportingAssetId, row.categoryId);
    }
    threatOf.set(row.cveId, Math.max(threatOf.get(row.cveId) ?? 0, row.threat));
    familySet.add(row.categoryId);
  }

  const families = [...familySet].sort(compareCodePoints);
  const familyIndexOf = new Map(families.map((family, index) => [family, index]));
  const cveIds = [...threatOf.keys()].sort(compareCodePoints);
  const cveIndexOf = new Map(cveIds.map((cveId, index) => [cveId, index]));
  const cves: Array<DoorCve> = cveIds.map((cveId) => ({
    cveId,
    threat: threatOf.get(cveId)!,
    priced: threatOf.get(cveId)! > SILENT_FLAW_THREAT,
  }));

  const openingsByAsset = Map.groupBy(strongest.values(), (row) => row.supportingAssetId);
  const assets: Array<DoorAsset> = [...openingsByAsset.keys()].sort(compareCodePoints).map((assetId) => {
    const rows = openingsByAsset.get(assetId)!;
    const openings: Array<DoorOpening> = rows
      .map((row) => ({
        cve: cveIndexOf.get(row.cveId)!,
        technique: techniqueIndexOf.get(row.techniqueExternalId)!,
        opening: row.opening,
      }))
      .sort((first, second) => (first.cve - second.cve) || (first.technique - second.technique));
    return { family: familyIndexOf.get(rows[0].categoryId)!, openings, target: targetAssetIds.has(assetId) };
  });

  const applicable = techniques.map((technique) =>
    Float64Array.from(families, (family) => countByPair.get(`${technique}|${family}`) ?? 0));

  const targetApplicable = techniques.map((technique) =>
    Float64Array.from(families, (family) => targetCountByPair.get(`${technique}|${family}`) ?? 0));

  const phishingTechnique = techniqueIndexOf.get(PHISHING_DELIVERY);
  let phishing: PhishingDoor | null = null;
  if (phishingTechnique !== undefined && (people.accounts > 0 || drawnPeople !== null)) {
    const openingsByDevice = Map.groupBy(deviceFlaws.values(), (row) => row.supportingAssetId);
    const deviceOf = (deviceId: string): PhishingDoor['persons'][number]['devices'][number] => ({
      family: familyIndexOf.get(deviceCategory.get(deviceId)!)!,
      openings: openingsByDevice.get(deviceId)!
        .map((row) => ({ cve: cveIndexOf.get(row.cveId)!, technique: phishingTechnique, opening: row.opening }))
        .sort((first, second) => first.cve - second.cve),
    });
    const users = pairedUsers(source.primaryUsers, carriedBy.get(PHISHING_DELIVERY), familyIndexOf);
    const flawed = new Set(users.filter((user) => user.devices.some((device) => openingsByDevice.has(device.deviceId))));
    const flawedCount = { target: 0, other: 0 };
    const persons: Array<PhishingDoor['persons'][number]> = [];
    for (const user of flawed) {
      flawedCount[user.target ? 'target' : 'other'] += 1;
      persons.push({
        target: user.target,
        devices: user.devices.map((device) => (openingsByDevice.has(device.deviceId)
          ? deviceOf(device.deviceId)
          : { family: device.family, openings: [] })),
      });
    }
    phishing = {
      personFamily: familyIndexOf.get('identity')!,
      deviceFamily: familyIndexOf.get('host') ?? -1,
      people: people.accounts,
      targetPeople: people.targetAccounts,
      persons,
      cleanPersons: cleanGroupsWithin(users.filter((user) => !flawed.has(user)), {
        target: Math.max(0, people.targetAccounts - flawedCount.target),
        other: Math.max(0, people.accounts - people.targetAccounts - flawedCount.other),
      }),
    };
  }

  const declared: Array<DoorDeclaredKind> = [...new Set([...drawnTechniques.keys(), ...(drawnPeople === null ? [] : [drawnPeople])])]
    .sort(compareCodePoints)
    .map((kind) => ({
      kind,
      family: familyIndexOf.get(drawnTechniques.get(kind)?.category ?? 'identity')!,
      techniques: (drawnTechniques.get(kind)?.techniques ?? []).map((technique) => techniqueIndexOf.get(technique)!),
      people: kind === drawnPeople && phishing !== null,
    }));

  return { techniques, families, cves, assets, applicable, targetApplicable, phishing, ...(declared.length === 0 ? {} : { declared }) };
};

interface PairedUser {
  readonly target: boolean,
  /** The distinct devices whose family the door holds, by id, with that family. */
  readonly devices: ReadonlyArray<{ readonly deviceId: string, readonly family: number }>,
}

/**
 * The primary users with at least one device the door can read phishing on, in identity order. A
 * pair given twice counts once, and an account is a target when any of its rows says so.
 */
const pairedUsers = (
  primaryUsers: ReadonlyArray<PrimaryUserRow>,
  carried: ReadonlySet<AssetCategory> | undefined,
  familyIndexOf: ReadonlyMap<AssetCategory, number>,
): Array<PairedUser> => {
  const byIdentity = new Map<string, { target: boolean, devices: Map<string, number> }>();
  for (const pair of primaryUsers) {
    const family = carried?.has(pair.deviceCategoryId) === true ? familyIndexOf.get(pair.deviceCategoryId) : undefined;
    if (family !== undefined) {
      const held = byIdentity.get(pair.identityId) ?? { target: false, devices: new Map<string, number>() };
      held.target = held.target || pair.identityTarget;
      held.devices.set(pair.deviceId, family);
      byIdentity.set(pair.identityId, held);
    }
  }
  return [...byIdentity.keys()].sort(compareCodePoints).map((identityId) => {
    const { target, devices } = byIdentity.get(identityId)!;
    return { target, devices: [...devices.keys()].sort(compareCodePoints).map((deviceId) => ({ deviceId, family: devices.get(deviceId)! })) };
  });
};

/**
 * The users grouped by the families of their devices and by target, in canonical order, with no
 * group taking more people than the counts leave room for.
 */
const cleanGroupsWithin = (
  users: ReadonlyArray<PairedUser>,
  room: { readonly target: number, readonly other: number },
): PhishingDoor['cleanPersons'] => {
  const counts = new Map<string, { families: Array<number>, target: boolean, count: number }>();
  for (const user of users) {
    const families = [...new Set(user.devices.map((device) => device.family))].sort((first, second) => first - second);
    const key = `${user.target ? 1 : 0}|${families.join(',')}`;
    const held = counts.get(key) ?? { families, target: user.target, count: 0 };
    held.count += 1;
    counts.set(key, held);
  }
  const left = { target: room.target, other: room.other };
  return [...counts.values()]
    .sort((first, second) => Number(second.target) - Number(first.target)
      || compareFamilies(first.families, second.families))
    .map((group) => {
      const side = group.target ? 'target' : 'other';
      const count = Math.min(group.count, left[side]);
      left[side] -= count;
      return { ...group, count };
    })
    .filter((group) => group.count > 0);
};

const compareFamilies = (first: ReadonlyArray<number>, second: ReadonlyArray<number>): number => {
  for (let at = 0; at < Math.min(first.length, second.length); at += 1) {
    if (first[at] !== second[at]) {
      return first[at] - second[at];
    }
  }
  return first.length - second.length;
};
