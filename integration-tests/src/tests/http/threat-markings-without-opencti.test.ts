import type { EventOrigin, ParsedThreatInput } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { signInAs } from '../../helpers/sign-in';
import { buildParsedEntry } from '../../helpers/threat-analyses-fixtures';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

const threat = (stixId: string, name: string, markingRefs: Array<string>): ParsedThreatInput => {
  const entry = buildParsedEntry('initial');
  return { ...entry, threat: { ...entry.threat, stixId, name, mitreGroupId: null, markingRefs } };
};

/**
 * A tenant with no OpenCTI connection has no OpenCTI to ask what a member may read, so the threats
 * it mirrored before the connection was removed are narrowed as if OpenCTI had not answered: only
 * the ones with no marking stay visible, to every member.
 */
describe('Marked mirrored threats in a tenant with no OpenCTI connection (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;
  let memberId: string;
  let adminOrigin: EventOrigin;
  let markedId: string;

  const namesListedFor = async (userId: string): Promise<Array<string>> => {
    await signInAs(client, userId);
    const list = await client.query('threats.list', {}, { tenantId });
    expect(list.status).toBe(200);
    return list.json.result.data.items.map((item: { name: string }) => item.name).sort();
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminId = setup.userId;
    adminOrigin = setup.origin;
    memberId = (await createTenantUser(services, db, adminOrigin)).userId;
    const scoped = services.withOrigin(adminOrigin);
    await scoped.threatAnalyses.ingestBundle([
      threat('intrusion-set--77777777-7777-4777-8777-777777777771', 'Marked Mirrored Actor', [TLP_RED]),
      threat('intrusion-set--77777777-7777-4777-8777-777777777772', 'Unmarked Mirrored Actor', []),
    ], tenantId, 'connector');
    await scoped.threatAnalyses.ingestBundle([
      threat('intrusion-set--77777777-7777-4777-8777-777777777773', 'Marked Imported Actor', [TLP_RED]),
    ], tenantId, 'stix-import');
    const mirrored = (await scoped.threatAnalyses.list({ page: 1, limit: 500, sortDesc: true })).items
      .find((item) => item.name === 'Marked Mirrored Actor');
    if (!mirrored) {
      throw new Error('the marked mirrored threat is not listed for an unnarrowed origin');
    }
    markedId = mirrored.id;
  });

  it('should list a member only the mirrored threat that carries no marking', async () => {
    expect(await namesListedFor(memberId)).toEqual(['Unmarked Mirrored Actor']);
  });

  it('should hide the marked mirrored threat from a tenant administrator too', async () => {
    expect(await namesListedFor(adminId)).toEqual(['Marked Imported Actor', 'Unmarked Mirrored Actor']);
  });

  it('should answer the detail of the marked mirrored threat as not found', async () => {
    await signInAs(client, memberId);
    const detail = await client.query('threats.getDetail', { id: markedId }, { tenantId });

    expect(detail.status).toBe(200);
    expect(detail.json.result.data).toBeNull();
  });

  it('should leave a threat imported from a STIX file to the reader\'s OpenCRQ clearance', async () => {
    expect(await namesListedFor(adminId)).toContain('Marked Imported Actor');
    expect(await namesListedFor(memberId)).not.toContain('Marked Imported Actor');
  });
});
