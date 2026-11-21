import type { EventOrigin, ParsedThreatInput } from '@app/module';
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
