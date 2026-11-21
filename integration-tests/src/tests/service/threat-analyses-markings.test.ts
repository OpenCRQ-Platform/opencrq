import type { EventOrigin, OpenCtiReaderAccess, ParsedThreatInput } from '@app/module';
import { openctiStreamObjects } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
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
 * A threat mirrored from OpenCTI also follows OpenCTI's organization sharing and authorized members
 * (opencrq #35): with a platform organization set, a reader outside it reads a shared threat only
 * when it is shared with one of their organizations; a threat restricted to members is read only by
 * a member; a reader OpenCTI did not answer for reads neither.
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

  it('should list a shared threat only to a reader of an organization it is shared with', async () => {
    expect(await listedStixIds(as(reader(['org-a'])))).toEqual([OPEN_ID, SHARED_ID]);
    expect(await listedStixIds(as(reader(['org-b'])))).toEqual([OPEN_ID]);
  });

  it('should not restrict on organizations a reader of the platform organization', async () => {
    expect(await listedStixIds(as(reader(['org-platform'])))).toEqual([OPEN_ID, SHARED_ID]);
  });

  it('should list a member-restricted threat only to a member', async () => {
    expect(await listedStixIds(as(reader(['org-platform'], ['group-1'])))).toEqual([MEMBERS_ID, OPEN_ID, SHARED_ID]);
  });

  it('should hide restricted threats from a reader OpenCTI did not answer for', async () => {
    expect(await listedStixIds(as(null))).toEqual([OPEN_ID]);
  });

  it('should leave a BYPASS reader every threat', async () => {
    expect(await listedStixIds(as({ ...reader([]), bypass: true }))).toEqual([MEMBERS_ID, OPEN_ID, SHARED_ID]);
  });
});
