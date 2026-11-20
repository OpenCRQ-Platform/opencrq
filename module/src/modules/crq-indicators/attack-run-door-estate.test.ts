import { describe, expect, it } from 'vitest';
import type { DoorCountRow, DoorEstateSource, EntryOpeningRow, PrimaryUserRow } from './attack-run-door-estate';
import { buildDoorEstate } from './attack-run-door-estate';

const count = (over: Partial<DoorCountRow> & Pick<DoorCountRow, 'target' | 'count'>): DoorCountRow => ({
  categoryId: 'host',
  subcategoryId: null,
  exposure: 'internet_facing',
  identityEnabled: true,
  ...over,
});

const opening = (over: Partial<EntryOpeningRow> & Pick<EntryOpeningRow, 'supportingAssetId' | 'target'>): EntryOpeningRow => ({
  categoryId: 'host',
  subcategoryId: null,
  exposure: 'internet_facing',
  cveId: 'cve-a',
  techniqueExternalId: 'T1190',
  opening: 0.5,
  threat: 0.4,
  ...over,
});

const sourceOf = (
  counts: ReadonlyArray<DoorCountRow>,
  openings: ReadonlyArray<EntryOpeningRow>,
  primaryUsers: ReadonlyArray<PrimaryUserRow> = [],
): DoorEstateSource => ({
  techniqueExternalIds: ['T1190', 'T1566'],
  applicableFamiliesByTechnique: new Map([['T1190', ['host', 'web_application'] as const], ['T1566', ['host'] as const]]),
  counts,
  openings,
  primaryUsers,
  unknownExposureCountsAs: 'internal',
});

const shuffled = <T>(rows: ReadonlyArray<T>): Array<T> => [...rows].reverse();

describe('buildDoorEstate targets', () => {
  const counts = [
    count({ target: true, count: 2 }),
    count({ target: false, count: 3 }),
    count({ categoryId: 'web_application', target: false, count: 4 }),
  ];
  const openings = [
    opening({ supportingAssetId: 'asset-1', target: true }),
    opening({ supportingAssetId: 'asset-2', target: false, cveId: 'cve-b', opening: 0.8 }),
    opening({ supportingAssetId: 'asset-3', target: false, categoryId: 'web_application', cveId: 'cve-b' }),
  ];

  it('splits applicable between its targets and the rest, targets included in applicable', () => {
    const door = buildDoorEstate(sourceOf(counts, openings));
    const host = door.families.indexOf('host');
    const web = door.families.indexOf('web_application');
    const t1190 = door.techniques.indexOf('T1190');
    expect(door.applicable[t1190][host]).toBe(5);
    expect(door.targetApplicable[t1190][host]).toBe(2);
    expect(door.applicable[t1190][web]).toBe(4);
    expect(door.targetApplicable[t1190][web]).toBe(0);
  });

  it('carries no target when no row says so', () => {
    const door = buildDoorEstate(sourceOf(
      counts.map((row) => ({ ...row, target: false })),
      openings.map((row) => ({ ...row, target: false })),
    ));
    door.targetApplicable.forEach((row) => expect(Array.from(row).every((value) => value === 0)).toBe(true));
    expect(door.assets.every((asset) => !asset.target)).toBe(true);
  });

  it('flags an asset as a target when its rows say so', () => {
    const door = buildDoorEstate(sourceOf(counts, openings));
    expect(door.assets.map((asset) => asset.target)).toEqual([true, false, false]);
  });

  it('counts an asset once, as a target, when some of its rows say it is and others say it is not', () => {
    const door = buildDoorEstate(sourceOf(counts, [
      opening({ supportingAssetId: 'asset-1', target: false, cveId: 'cve-a' }),
      opening({ supportingAssetId: 'asset-1', target: true, cveId: 'cve-b' }),
      opening({ supportingAssetId: 'asset-1', target: false, cveId: 'cve-c' }),
    ]));
    expect(door.assets).toHaveLength(1);
    expect(door.assets[0].target).toBe(true);
    expect(door.assets[0].openings).toHaveLength(3);
  });

  it('builds the same estate, targets included, whatever order the rows come in', () => {
    const door = buildDoorEstate(sourceOf(counts, openings));
    const permuted = buildDoorEstate(sourceOf(shuffled(counts), shuffled(openings)));
    expect(permuted).toEqual(door);
  });

  it('leaves a target row that no technique applies to out of targetApplicable', () => {
    const door = buildDoorEstate(sourceOf([count({ categoryId: 'web_application', exposure: 'internal', target: true, count: 2 })], []));
    door.targetApplicable.forEach((row) => expect(Array.from(row).every((value) => value === 0)).toBe(true));
  });
});

describe('buildDoorEstate phishing', () => {
  const sourceWithPeople = (
    counts: ReadonlyArray<DoorCountRow>,
    openings: ReadonlyArray<EntryOpeningRow>,
    primaryUsers: ReadonlyArray<PrimaryUserRow> = [],
  ): DoorEstateSource => ({
    ...sourceOf(counts, openings, primaryUsers),
    techniqueExternalIds: ['T1190', 'T1566', 'T1189'],
    applicableFamiliesByTechnique: new Map([
      ['T1190', ['host', 'web_application'] as const],
      ['T1566', ['host', 'identity'] as const],
      ['T1189', ['host'] as const],
    ]),
  });

  const account = (over: Partial<DoorCountRow> & Pick<DoorCountRow, 'count'>): DoorCountRow =>
    count({ categoryId: 'identity', subcategoryId: 'user_account', exposure: 'unknown', target: false, ...over });
  const workstation = (over: Partial<DoorCountRow> & Pick<DoorCountRow, 'count'>): DoorCountRow =>
    count({ subcategoryId: 'workstation', exposure: 'internal', target: false, ...over });
  const clientFlaw = (assetId: string, cveId: string, technique: string, over: Partial<EntryOpeningRow> = {}): EntryOpeningRow =>
    opening({ supportingAssetId: assetId, target: false, subcategoryId: 'workstation', exposure: 'internal', cveId, techniqueExternalId: technique, opening: 0.6, ...over });

  it('counts the people on the enabled user accounts, the targets apart', () => {
    const door = buildDoorEstate(sourceWithPeople([
      account({ count: 40 }),
      account({ count: 5, target: true }),
      account({ count: 6, subcategoryId: 'service_account' }),
      workstation({ count: 50 }),
    ], []));
    expect(door.phishing).toMatchObject({
      personFamily: door.families.indexOf('identity'),
      deviceFamily: door.families.indexOf('host'),
      people: 45,
      targetPeople: 5,
    });
  });

  it('has no phishing on an estate with hosts and no user account, and counts no host as a person', () => {
    const door = buildDoorEstate(sourceWithPeople([
      workstation({ count: 30 }),
      workstation({ count: 4, target: true }),
      workstation({ count: 10, subcategoryId: 'laptop' }),
      workstation({ count: 5, subcategoryId: null }),
    ], [
      clientFlaw('ws-1', 'cve-a', 'T1566'),
      clientFlaw('ws-2', 'cve-a', 'T1566', { target: true }),
    ]));
    const technique = door.techniques.indexOf('T1566');
    expect(door.phishing).toBeNull();
    expect(Array.from(door.applicable[technique]).every((value) => value === 0)).toBe(true);
    expect(Array.from(door.targetApplicable[technique]).every((value) => value === 0)).toBe(true);
    expect(door.assets.flatMap((asset) => asset.openings)).toEqual([]);
  });

  it('counts no group, role or shared mailbox as a person', () => {
    const door = buildDoorEstate(sourceWithPeople([
      account({ count: 2, subcategoryId: 'group' }),
      account({ count: 3, subcategoryId: 'role' }),
      account({ count: 4, subcategoryId: 'shared_mailbox' }),
      account({ count: 5, subcategoryId: 'service_account' }),
      workstation({ count: 50 }),
    ], []));
    expect(door.phishing).toBeNull();
  });

  it('counts a disabled account as no person', () => {
    const door = buildDoorEstate(sourceWithPeople([
      account({ count: 2 }),
      account({ count: 3, identityEnabled: false }),
      workstation({ count: 50 }),
    ], []));
    expect(door.phishing).toMatchObject({ personFamily: door.families.indexOf('identity'), people: 2 });

    const onlyDisabled = buildDoorEstate(sourceWithPeople([account({ count: 3, identityEnabled: false }), workstation({ count: 50 })], []));
    expect(onlyDisabled.phishing).toBeNull();
  });

  it('files the T1566 openings of a device under its primary users, and leaves T1189 on the device', () => {
    const door = buildDoorEstate(sourceWithPeople(
      [account({ count: 3 }), workstation({ count: 20 })],
      [
        clientFlaw('device-1', 'cve-a', 'T1566'),
        clientFlaw('device-1', 'cve-a', 'T1189'),
        clientFlaw('device-2', 'cve-b', 'T1566'),
        clientFlaw('device-2', 'cve-b', 'T1189'),
      ],
      [{ identityId: 'user-1', deviceId: 'device-1', deviceCategoryId: 'host', identityTarget: true }],
    ));
    const technique = door.techniques.indexOf('T1566');
    const host = door.families.indexOf('host');
    const cveA = door.cves.findIndex((cve) => cve.cveId === 'cve-a');

    expect(door.phishing?.persons).toEqual([{ target: true, devices: [{ family: host, openings: [{ cve: cveA, technique, opening: 0.6 }] }] }]);
    expect(door.assets).toHaveLength(2);
    expect(door.assets.flatMap((asset) => asset.openings.map((entry) => entry.technique)).every((index) => index !== technique)).toBe(true);
    expect(door.assets.flatMap((asset) => asset.openings)).toHaveLength(2);
    expect(door.cves.map((cve) => cve.cveId)).toEqual(['cve-a', 'cve-b']);
    expect(Array.from(door.applicable[technique]).every((value) => value === 0)).toBe(true);
    expect(Array.from(door.targetApplicable[technique]).every((value) => value === 0)).toBe(true);
  });

  it('lists a device shared by two users under each of them, and a person with two devices once', () => {
    const door = buildDoorEstate(sourceWithPeople(
      [account({ count: 3 }), workstation({ count: 20 })],
      [clientFlaw('device-1', 'cve-a', 'T1566'), clientFlaw('device-2', 'cve-b', 'T1566')],
      [
        { identityId: 'user-1', deviceId: 'device-1', deviceCategoryId: 'host', identityTarget: false },
        { identityId: 'user-2', deviceId: 'device-1', deviceCategoryId: 'host', identityTarget: false },
        { identityId: 'user-2', deviceId: 'device-2', deviceCategoryId: 'host', identityTarget: false },
      ],
    ));
    expect(door.phishing?.persons.map((person) => person.devices.length).sort()).toEqual([1, 2]);
  });

  it('counts a pair given twice once', () => {
    const rows = [clientFlaw('device-1', 'cve-a', 'T1566')];
    const pair: PrimaryUserRow = { identityId: 'user-1', deviceId: 'device-1', deviceCategoryId: 'host', identityTarget: false };
    const counts = [account({ count: 3 }), workstation({ count: 20 })];
    expect(buildDoorEstate(sourceWithPeople(counts, rows, [pair, pair]))).toEqual(buildDoorEstate(sourceWithPeople(counts, rows, [pair])));
  });

  it('builds the same phishing door whatever order the rows come in', () => {
    const counts = [account({ count: 30 }), account({ count: 4, target: true }), workstation({ count: 20 })];
    const rows = [
      clientFlaw('device-1', 'cve-a', 'T1566'),
      clientFlaw('device-1', 'cve-b', 'T1566', { opening: 0.2 }),
      clientFlaw('device-1', 'cve-b', 'T1566.002', { opening: 0.4 }),
      clientFlaw('device-2', 'cve-b', 'T1566'),
      clientFlaw('device-2', 'cve-c', 'T1189'),
    ];
    const users: ReadonlyArray<PrimaryUserRow> = [
      { identityId: 'user-1', deviceId: 'device-1', deviceCategoryId: 'host', identityTarget: true },
      { identityId: 'user-2', deviceId: 'device-1', deviceCategoryId: 'host', identityTarget: false },
      { identityId: 'user-2', deviceId: 'device-2', deviceCategoryId: 'host', identityTarget: false },
    ];
    const door = buildDoorEstate(sourceWithPeople(counts, rows, users));
    expect(door.phishing?.persons).toHaveLength(2);
    expect(buildDoorEstate(sourceWithPeople(shuffled(counts), shuffled(rows), shuffled(users)))).toEqual(door);
  });

  describe('the people whose devices carry no flaw', () => {
    const withPhones = (
      counts: ReadonlyArray<DoorCountRow>,
      openings: ReadonlyArray<EntryOpeningRow>,
      primaryUsers: ReadonlyArray<PrimaryUserRow>,
    ): DoorEstateSource => ({
      ...sourceWithPeople(counts, openings, primaryUsers),
      applicableFamiliesByTechnique: new Map([
        ['T1190', ['host', 'web_application'] as const],
        ['T1566', ['host', 'identity', 'mobile_device'] as const],
        ['T1189', ['host'] as const],
      ]),
    });
    const phone = (over: Partial<DoorCountRow> & Pick<DoorCountRow, 'count'>): DoorCountRow =>
      count({ categoryId: 'mobile_device', subcategoryId: null, exposure: 'internal', target: false, ...over });
    const pair = (identityId: string, deviceId: string, deviceCategoryId: PrimaryUserRow['deviceCategoryId'], identityTarget = false): PrimaryUserRow =>
      ({ identityId, deviceId, deviceCategoryId, identityTarget });
    const counts = [account({ count: 20 }), account({ count: 3, target: true }), workstation({ count: 20 }), phone({ count: 10 })];

    it('groups them by the families of their devices and by target, a person with a phone and a workstation in a group of its own', () => {
      const door = buildDoorEstate(withPhones(counts, [], [
        pair('user-1', 'phone-1', 'mobile_device'),
        pair('user-2', 'phone-2', 'mobile_device'),
        pair('user-3', 'ws-3', 'host'),
        pair('user-4', 'ws-4', 'host'),
        pair('user-4', 'phone-4', 'mobile_device'),
        pair('user-5', 'phone-5', 'mobile_device', true),
      ]));
      const host = door.families.indexOf('host');
      const mobile = door.families.indexOf('mobile_device');
      expect(door.phishing?.persons).toEqual([]);
      expect(door.phishing?.cleanPersons).toEqual([
        { families: [mobile], target: true, count: 1 },
        { families: [host], target: false, count: 1 },
        { families: [host, mobile], target: false, count: 1 },
        { families: [mobile], target: false, count: 2 },
      ]);
    });

    it('leaves a person with a flawed device to the listed persons and out of the groups', () => {
      const door = buildDoorEstate(withPhones(counts, [clientFlaw('ws-1', 'cve-a', 'T1566')], [
        pair('user-1', 'ws-1', 'host'),
        pair('user-1', 'phone-1', 'mobile_device'),
        pair('user-2', 'phone-2', 'mobile_device'),
      ]));
      expect(door.phishing?.persons).toHaveLength(1);
      expect(door.phishing?.cleanPersons).toEqual([{ families: [door.families.indexOf('mobile_device')], target: false, count: 1 }]);
    });

    it('counts a pair given twice, and a device shared by two users, once per user', () => {
      const rows = [pair('user-1', 'phone-1', 'mobile_device'), pair('user-2', 'phone-1', 'mobile_device')];
      const door = buildDoorEstate(withPhones(counts, [], [...rows, rows[0]]));
      expect(door.phishing?.cleanPersons).toEqual([{ families: [door.families.indexOf('mobile_device')], target: false, count: 2 }]);
    });

    it('flags a group as a target when any row of the account says so', () => {
      const door = buildDoorEstate(withPhones(counts, [], [pair('user-1', 'phone-1', 'mobile_device'), pair('user-1', 'phone-2', 'mobile_device', true)]));
      expect(door.phishing?.cleanPersons).toEqual([{ families: [door.families.indexOf('mobile_device')], target: true, count: 1 }]);
    });

    it('never counts more people than the counts hold, targets and others apart', () => {
      const users = Array.from({ length: 30 }, (_, index) => pair(`user-${String(index).padStart(2, '0')}`, `phone-${index}`, 'mobile_device', index < 7));
      const door = buildDoorEstate(withPhones(counts, [], users));
      const grouped = (target: boolean): number => (door.phishing?.cleanPersons ?? [])
        .filter((group) => group.target === target)
        .reduce((total, group) => total + group.count, 0);
      expect(grouped(true)).toBe(3);
      expect(grouped(false)).toBe(20);
    });

    it('leaves room for the listed persons before the groups take any', () => {
      const users = Array.from({ length: 30 }, (_, index) => pair(`user-${String(index).padStart(2, '0')}`, `phone-${index}`, 'mobile_device'));
      const door = buildDoorEstate(withPhones(counts, [clientFlaw('phone-0', 'cve-a', 'T1566', { categoryId: 'mobile_device', subcategoryId: null })], users));
      expect(door.phishing?.persons).toHaveLength(1);
      expect((door.phishing?.cleanPersons ?? []).reduce((total, group) => total + group.count, 0)).toBe(19);
    });

    it('ignores a device whose family the technique does not reach', () => {
      const door = buildDoorEstate(withPhones(counts, [], [pair('user-1', 'cloud-1', 'cloud_resource')]));
      expect(door.phishing?.cleanPersons).toEqual([]);
    });

    it('builds the same groups whatever order the pairs come in', () => {
      const users = [
        pair('user-1', 'phone-1', 'mobile_device'),
        pair('user-2', 'ws-2', 'host', true),
        pair('user-3', 'ws-3', 'host'),
        pair('user-3', 'phone-3', 'mobile_device'),
        pair('user-4', 'phone-4', 'mobile_device'),
      ];
      const door = buildDoorEstate(withPhones(counts, [], users));
      expect(door.phishing?.cleanPersons.length).toBeGreaterThan(2);
      expect(buildDoorEstate(withPhones(counts, [], shuffled(users)))).toEqual(door);
    });
  });
});
