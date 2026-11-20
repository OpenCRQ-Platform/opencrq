import { describe, expect, it } from 'vitest';
import type { DoorCountRow } from './attack-run-door-estate';
import type { DeclaredKindRow } from './declared-estate-completion';
import { completeDeclaredEstate } from './declared-estate-completion';

const door = (
  categoryId: DoorCountRow['categoryId'],
  subcategoryId: DoorCountRow['subcategoryId'],
  exposure: DoorCountRow['exposure'],
  count: number,
  identityEnabled = true,
): DoorCountRow => ({ categoryId, subcategoryId, exposure, identityEnabled, target: false, count });

const declared = (kind: DeclaredKindRow['kind'], low: number, internetFacing: boolean | null = null, high = low): DeclaredKindRow => ({ kind, low, high, internetFacing });

describe('completeDeclaredEstate', () => {
  it('should add nothing when nothing is declared', () => {
    expect(completeDeclaredEstate([], [door('host', 'server', 'internal', 3)], 'internal')).toEqual({ counts: [], doorCounts: [], kinds: [] });
  });

  it('should complete an empty estate up to each declared low bound, as internal assets of unknown criticality', () => {
    const completion = completeDeclaredEstate([declared('workstations', 120), declared('servers', 8)], [], 'internal');

    expect(completion.counts).toEqual([
      { categoryId: 'host', exposure: 'internal', criticality: 'unknown', count: 120 },
      { categoryId: 'host', exposure: 'internal', criticality: 'unknown', count: 8 },
    ]);
    expect(completion.doorCounts).toEqual([
      door('host', 'workstation', 'internal', 120),
      door('host', 'server', 'internal', 8),
    ]);
  });

  it('should add only what the measured assets leave short of the low bound', () => {
    const completion = completeDeclaredEstate([declared('servers', 10)], [door('host', 'server', 'internal', 4), door('host', 'hypervisor', 'internal', 2)], 'internal');

    expect(completion.doorCounts).toEqual([door('host', 'server', 'internal', 4)]);
  });

  it('should add nothing to a kind whose measured assets reach the low bound', () => {
    expect(completeDeclaredEstate([declared('servers', 5)], [door('host', 'server', 'internal', 7)], 'internal').counts).toEqual([]);
  });

  it('should count a host with no subcategory as a workstation and leave groups, roles and the unclassified out of every kind', () => {
    const measured = [
      door('host', null, 'internal', 30),
      door('identity', 'group', 'internal', 50),
      door('identity', 'role', 'internal', 50),
      door('identity', 'shared_mailbox', 'internal', 50),
      door('generic_asset', null, 'internal', 50),
    ];
    const completion = completeDeclaredEstate([declared('workstations', 40), declared('people', 10), declared('service_accounts', 5)], measured, 'internal');

    expect(completion.doorCounts).toEqual([
      door('host', 'workstation', 'internal', 10),
      door('identity', 'user_account', 'internal', 10),
      door('identity', 'service_account', 'internal', 5),
    ]);
  });

  it('should count no disabled account as a person, and a virtual person as an enabled user account', () => {
    const completion = completeDeclaredEstate([declared('people', 10)], [door('identity', 'user_account', 'internal', 8, false), door('identity', 'user_account', 'internal', 3)], 'internal');

    expect(completion.doorCounts).toEqual([door('identity', 'user_account', 'internal', 7)]);
  });

  it('should count an IAM principal as a cloud resource', () => {
    expect(completeDeclaredEstate([declared('cloud_resources', 3)], [door('cloud_resource', 'iam_principal', 'internal', 3)], 'internal').counts).toEqual([]);
  });

  describe('exposure', () => {
    it('should make one virtual asset exposed within the completion when no real asset of the kind is', () => {
      const completion = completeDeclaredEstate([declared('servers', 10, true)], [door('host', 'server', 'internal', 4)], 'internal');

      expect(completion.doorCounts).toEqual([door('host', 'server', 'internet_facing', 1), door('host', 'server', 'internal', 5)]);
    });

    it('should add one exposed asset above the measured ones when they reach the low bound and are all internal', () => {
      const completion = completeDeclaredEstate([declared('servers', 2, true)], [door('host', 'server', 'internal', 6)], 'internal');

      expect(completion.doorCounts).toEqual([door('host', 'server', 'internet_facing', 1)]);
    });

    it('should add no exposed asset when a real asset of the kind is exposed', () => {
      const completion = completeDeclaredEstate([declared('web_applications', 3, true)], [door('web_application', 'website', 'internet_facing', 1)], 'internal');

      expect(completion.doorCounts).toEqual([door('web_application', null, 'internal', 2)]);
    });

    it('should read an unknown exposure as the tenant setting says', () => {
      const measured = [door('web_application', 'website', 'unknown', 1)];

      expect(completeDeclaredEstate([declared('web_applications', 1, true)], measured, 'internet_facing').doorCounts).toEqual([]);
      expect(completeDeclaredEstate([declared('web_applications', 1, true)], measured, 'internal').doorCounts)
        .toEqual([door('web_application', null, 'internet_facing', 1)]);
    });

    it('should add no exposed asset on a "no"', () => {
      expect(completeDeclaredEstate([declared('servers', 1, false)], [], 'internal').doorCounts).toEqual([door('host', 'server', 'internal', 1)]);
    });
  });
});
