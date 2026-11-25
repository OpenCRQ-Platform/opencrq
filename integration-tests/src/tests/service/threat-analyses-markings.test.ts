import type { EventOrigin, OpenCtiReaderAccess, ParsedThreatInput } from '@app/module';
import { openctiStreamObjects, withoutReaderScope } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { buildParsedEntry, DEFAULT_LIST_PARAMS } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';
const TLP_AMBER = 'marking-definition--f88d31f6-486f-44da-b317-01333bde0b82';
const MARKED_ID = 'intrusion-set--44444444-4444-4444-8444-444444444441';
const UNMARKED_ID = 'intrusion-set--44444444-4444-4444-8444-444444444442';

const mirrored = (stixId: string, name: string, markingRefs: Array<string>): ParsedThreatInput => {
  const entry = buildParsedEntry('initial');
  return { ...entry, threat: { ...entry.threat, stixId, name, mitreGroupId: null, markingRefs } };
};

/**
 * A threat mirrored from OpenCTI is read by a person only when all its markings are among the ones
 * OpenCTI lets them read (opencrq #31, OpenAEV ADR-009): multi-marking is AND, an unmarked threat is
 * visible to all, a reader whose markings OpenCTI did not answer holds no clearance, and a hidden
 * threat's detail is not found rather than refused.
 */
describe('OpenCTI marking segregation of mirrored threats', () => {
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let tenantId: string;

  const as = (markings: ReadonlyArray<string> | null): EventOrigin => ({ ...adminOrigin, markings });

  const listedStixIds = async (origin: EventOrigin, search?: string): Promise<Array<string>> =>
    (await services.withOrigin(origin).threatAnalyses.list({ ...DEFAULT_LIST_PARAMS, search }))
      .items.map((item) => item.stixId).sort();

  const idOf = async (stixId: string): Promise<string> => {
    const items = (await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS)).items;
    const found = items.find((item) => item.stixId === stixId);
    if (!found) {
      throw new Error(`${stixId} not listed for an unnarrowed origin`);
    }
    return found.id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      mirrored(MARKED_ID, 'Marked Actor', [TLP_RED, TLP_AMBER]),
      mirrored(UNMARKED_ID, 'Unmarked Actor', []),
    ], tenantId, 'connector');
  });

  it('should list a marked threat to a member holding every one of its markings', async () => {
    expect(await listedStixIds(as([TLP_AMBER, TLP_RED]))).toEqual([MARKED_ID, UNMARKED_ID]);
  });

  it('should hide a marked threat from a member missing one of its markings', async () => {
    expect(await listedStixIds(as([TLP_AMBER]))).toEqual([UNMARKED_ID]);
  });

  it('should leave only unmarked threats to a reader OpenCTI did not answer for', async () => {
    expect(await listedStixIds(as(null))).toEqual([UNMARKED_ID]);
    expect(await listedStixIds(as([]))).toEqual([UNMARKED_ID]);
  });

  it('should hide a marked threat from search', async () => {
    expect(await listedStixIds(as([TLP_AMBER]), 'Marked Actor')).toEqual([]);
    expect(await listedStixIds(as([TLP_AMBER, TLP_RED]), 'Marked Actor')).toEqual([MARKED_ID]);
  });

  it('should answer a hidden threat\'s detail as not found', async () => {
    const markedId = await idOf(MARKED_ID);

    expect(await services.withOrigin(as([TLP_AMBER])).threatAnalyses.getDetail(markedId)).toBeUndefined();
    expect(await services.withOrigin(as([TLP_AMBER, TLP_RED])).threatAnalyses.getDetail(markedId)).toBeDefined();
  });

  it('should not narrow an origin that carries no marking scope', async () => {
    expect(await listedStixIds(adminOrigin)).toEqual([MARKED_ID, UNMARKED_ID]);
  });
});

/**
 * A threat the tenant imported from a STIX file follows the reader's OpenCRQ clearance (CTEM marking
 * parity, G2 slice 3c-2): every marking it carries that the tenant defines must be held through one
 * of the reader's groups; a marking the tenant does not define (a producer's own statement) does not
 * restrict it; a hidden threat's detail is not found.
 */
describe('OpenCRQ clearance on imported threats', () => {
  const IMPORTED_RED_ID = 'intrusion-set--66666666-6666-4666-8666-666666666661';
  const IMPORTED_STATEMENT_ID = 'intrusion-set--66666666-6666-4666-8666-666666666662';
  const STATEMENT = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let memberOrigin: EventOrigin;

  const listedStixIds = async (origin: EventOrigin): Promise<Array<string>> =>
    (await services.withOrigin(origin).threatAnalyses.list(DEFAULT_LIST_PARAMS)).items.map((item) => item.stixId).sort();

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    memberOrigin = (await createTenantUser(services, db, adminOrigin)).origin;
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      mirrored(IMPORTED_RED_ID, 'Imported Red Actor', [TLP_RED]),
      mirrored(IMPORTED_STATEMENT_ID, 'Imported Statement Actor', [STATEMENT]),
    ], setup.tenantId, 'stix-import');
  });

  it('should list a marked import to a member of a group cleared for its marking', async () => {
    expect(await listedStixIds(adminOrigin)).toEqual([IMPORTED_RED_ID, IMPORTED_STATEMENT_ID]);
  });

  it('should hide a marked import from a member with no clearance, and answer its detail as not found', async () => {
    expect(await listedStixIds(memberOrigin)).toEqual([IMPORTED_STATEMENT_ID]);
    const redId = (await services.withOrigin(adminOrigin).threatAnalyses.list(DEFAULT_LIST_PARAMS)).items
      .find((item) => item.stixId === IMPORTED_RED_ID)!.id;
    expect(await services.withOrigin(memberOrigin).threatAnalyses.getDetail(redId)).toBeUndefined();
  });
});

/**
 * A threat mirrored from OpenCTI also follows OpenCTI's organization sharing and authorized members
 * (opencrq #35): with a platform organization set, a reader outside it reads a threat of a
 * restricted type only when it is shared with one of their organizations, an unshared one included
 * (`isEntityOrganizationsAllowed` in opencti-graphql `utils/access.ts` admits no empty sharing);
 * a threat restricted to members is read only by a member; a reader OpenCTI did not answer for
 * reads neither. Expected ids are written sorted, as `listedStixIds` sorts them.
 */
describe('OpenCTI organization segregation of mirrored threats', () => {
  const OCTI_EXTENSION = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';
  const SHARED_ID = 'intrusion-set--55555555-5555-4555-8555-555555555551';
  const MEMBERS_ID = 'intrusion-set--55555555-5555-4555-8555-555555555552';
  const OPEN_ID = 'intrusion-set--55555555-5555-4555-8555-555555555553';
  const reader = (organizationIds: Array<string>, groupIds: Array<string> = []): OpenCtiReaderAccess => ({
    userId: 'octi-user', individualId: null, organizationIds, groupIds, bypass: false, platformOrganizationId: 'org-platform',
  });
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let tenantId: string;

  const as = (access: OpenCtiReaderAccess | null): EventOrigin => ({ ...adminOrigin, markings: [], openctiAccess: access });
  const listedStixIds = async (origin: EventOrigin): Promise<Array<string>> =>
    (await services.withOrigin(origin).threatAnalyses.list(DEFAULT_LIST_PARAMS)).items.map((item) => item.stixId).sort();

  const mirror = (stixId: string, extension: Record<string, unknown>) => db.insert(openctiStreamObjects).values({
    id: uuidv7(),
    tenantId,
    stixId,
    stixType: 'intrusion-set',
    data: { id: stixId, type: 'intrusion-set', extensions: { [OCTI_EXTENSION]: { id: `internal-${stixId}`, type: 'Intrusion-Set', ...extension } } },
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      mirrored(SHARED_ID, 'Shared Actor', []),
      mirrored(MEMBERS_ID, 'Members Actor', []),
      mirrored(OPEN_ID, 'Open Actor', []),
    ], tenantId, 'connector');
    await mirror(SHARED_ID, { granted_refs_ids: ['org-a'] });
    await mirror(MEMBERS_ID, { authorized_members: [{ id: 'group-1', access_right: 'view' }] });
    await mirror(OPEN_ID, {});
  });

  it('should list to a reader outside the platform organization only the threats shared with their organizations', async () => {
    expect(await listedStixIds(as(reader(['org-a'])))).toEqual([SHARED_ID]);
    expect(await listedStixIds(as(reader(['org-b'])))).toEqual([]);
  });

  it('should not restrict on organizations a reader of the platform organization', async () => {
    expect(await listedStixIds(as(reader(['org-platform'])))).toEqual([SHARED_ID, OPEN_ID]);
  });

  it('should list a member-restricted threat only to a member', async () => {
    expect(await listedStixIds(as(reader(['org-platform'], ['group-1'])))).toEqual([SHARED_ID, MEMBERS_ID, OPEN_ID]);
  });

  it('should hide restricted threats from a reader OpenCTI did not answer for', async () => {
    expect(await listedStixIds(as(null))).toEqual([OPEN_ID]);
  });

  it('should leave a BYPASS reader every threat', async () => {
    expect(await listedStixIds(as({ ...reader([]), bypass: true }))).toEqual([SHARED_ID, MEMBERS_ID, OPEN_ID]);
  });
});

/**
 * A link to a threat the reader's OpenCTI rights hide is told from one to a threat that does not
 * exist by whether the id exists once their OpenCTI scope is set aside: the tenant and the OpenCRQ
 * clearance still narrow it, so another tenant's id and a threat an OpenCRQ marking hides stay as absent.
 */
describe('A threat hidden by the reader\'s OpenCTI rights, told from one that does not exist', () => {
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let tenantId: string;
  let hiddenId: string;
  let openId: string;

  const exists = (origin: EventOrigin, id: string) => services.withOrigin(origin).threatAnalyses.exists(id);
  const idOf = async (origin: EventOrigin, stixId: string): Promise<string> => {
    const found = (await services.withOrigin(origin).threatAnalyses.list(DEFAULT_LIST_PARAMS)).items.find((item) => item.stixId === stixId);
    if (!found) {
      throw new Error(`${stixId} not listed`);
    }
    return found.id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      mirrored(MARKED_ID, 'Marked Actor', [TLP_RED]),
      mirrored(UNMARKED_ID, 'Unmarked Actor', []),
    ], tenantId, 'connector');
    hiddenId = await idOf(adminOrigin, MARKED_ID);
    openId = await idOf(adminOrigin, UNMARKED_ID);
  });

  it('should find a threat the reader\'s OpenCTI rights hide only once their OpenCTI scope is set aside', async () => {
    const reader: EventOrigin = { ...adminOrigin, markings: [] };

    expect(await exists(reader, hiddenId)).toBe(false);
    expect(await exists(withoutReaderScope(reader), hiddenId)).toBe(true);
  });

  it('should find a threat the reader reads, with or without their OpenCTI scope', async () => {
    const reader: EventOrigin = { ...adminOrigin, markings: [] };

    expect(await exists(reader, openId)).toBe(true);
    expect(await exists(withoutReaderScope(reader), openId)).toBe(true);
  });

  it('should find a threat hidden from a reader OpenCTI did not answer for', async () => {
    const reader: EventOrigin = { ...adminOrigin, markings: null, openctiAccess: null };

    expect(await exists(reader, hiddenId)).toBe(false);
    expect(await exists(withoutReaderScope(reader), hiddenId)).toBe(true);
  });

  it('should find no id that does not exist', async () => {
    const reader: EventOrigin = { ...adminOrigin, markings: [] };

    expect(await exists(withoutReaderScope(reader), uuidv7())).toBe(false);
  });

  it('should find no threat of another tenant, even with the OpenCTI scope set aside', async () => {
    const other = await createTenantWithAdmin(services);
    await services.withOrigin(other.origin).threatAnalyses.ingestBundle([
      mirrored('intrusion-set--44444444-4444-4444-8444-444444444449', 'Other Tenant Actor', []),
    ], other.tenantId, 'connector');
    const otherId = await idOf(other.origin, 'intrusion-set--44444444-4444-4444-8444-444444444449');

    expect(await exists(adminOrigin, otherId)).toBe(false);
    expect(await exists(withoutReaderScope({ ...adminOrigin, markings: [] }), otherId)).toBe(false);
    expect(await exists(other.origin, otherId)).toBe(true);
  });

  it('should find no import an OpenCRQ marking hides from the reader, whatever their OpenCTI scope', async () => {
    const member = (await createTenantUser(services, db, adminOrigin)).origin;
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      mirrored('intrusion-set--66666666-6666-4666-8666-666666666669', 'Imported Red Actor', [TLP_RED]),
    ], tenantId, 'stix-import');
    const importedId = await idOf(adminOrigin, 'intrusion-set--66666666-6666-4666-8666-666666666669');

    expect(await exists(member, importedId)).toBe(false);
    expect(await exists(withoutReaderScope(member), importedId)).toBe(false);
  });
});

/**
 * The notice that threats are hidden is told only to a reader OpenCTI did not answer for, and only
 * while the tenant holds a mirrored threat that reader cannot read.
 */
describe('A mirrored threat hidden from a reader OpenCTI did not answer for', () => {
  const OCTI_EXTENSION = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';
  let adminOrigin: Extract<EventOrigin, { type: 'client' }>;
  let tenantId: string;

  const anyHidden = (origin: EventOrigin = adminOrigin) =>
    services.withOrigin(withoutReaderScope(origin)).threatAnalyses.hasThreatHiddenFromUnresolvedReader();
  const ingest = (threats: Array<ParsedThreatInput>, kind: 'connector' | 'stix-import' = 'connector') =>
    services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(threats, tenantId, kind);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  it('should find none in a tenant that holds no threat yet', async () => {
    expect(await anyHidden()).toBe(false);
  });

  it('should find none while every mirrored threat is unmarked and unrestricted', async () => {
    await ingest([mirrored(UNMARKED_ID, 'Unmarked Actor', [])]);

    expect(await anyHidden()).toBe(false);
  });

  it('should find a marked mirrored threat', async () => {
    await ingest([mirrored(UNMARKED_ID, 'Unmarked Actor', []), mirrored(MARKED_ID, 'Marked Actor', [TLP_RED])]);

    expect(await anyHidden()).toBe(true);
  });

  it('should find a mirrored threat whose body restricts it to members', async () => {
    await ingest([mirrored(UNMARKED_ID, 'Unmarked Actor', [])]);
    await db.insert(openctiStreamObjects).values({
      id: uuidv7(),
      tenantId,
      stixId: UNMARKED_ID,
      stixType: 'intrusion-set',
      data: { id: UNMARKED_ID, type: 'intrusion-set', extensions: { [OCTI_EXTENSION]: { id: 'internal', type: 'Intrusion-Set', authorized_members: [{ id: 'group-1', access_right: 'view' }] } } },
    });

    expect(await anyHidden()).toBe(true);
  });

  it('should not count a marked import, which OpenCTI\'s rights never narrow', async () => {
    await ingest([mirrored(MARKED_ID, 'Imported Actor', [TLP_RED])], 'stix-import');

    expect(await anyHidden()).toBe(false);
  });

  it('should not count a marked mirrored threat of another tenant', async () => {
    const other = await createTenantWithAdmin(services);
    await services.withOrigin(other.origin).threatAnalyses.ingestBundle([
      mirrored(MARKED_ID, 'Other Tenant Actor', [TLP_RED]),
    ], other.tenantId, 'connector');

    expect(await anyHidden()).toBe(false);
    expect(await anyHidden(other.origin)).toBe(true);
  });
});
