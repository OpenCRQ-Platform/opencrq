import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FakeOpenCtiGraphql } from '../../helpers/fake-opencti-graphql';
import { startFakeOpenCtiGraphql } from '../../helpers/fake-opencti-graphql';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { testConnectorsConfig } from '../../setup/mock';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

const INDICATOR_FILTER = JSON.stringify({
  mode: 'and',
  filters: [
    { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Indicator'] },
    { key: 'confidence', operator: 'gte', mode: 'or', values: [70] },
  ],
  filterGroups: [],
});

/** Admits actors and what they target, but nothing they use, so it cannot supply the parser. */
const PARTIAL_ACTOR_FILTER = JSON.stringify({
  mode: 'or',
  filters: [{ key: 'entity_type', operator: 'eq', mode: 'or', values: ['Intrusion-Set'] }],
  filterGroups: [{
    mode: 'and',
    filters: [
      { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['targets'] },
      { key: ['fromTypes'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] },
    ],
    filterGroups: [],
  }],
});

const SUPPLYING_FILTER = JSON.stringify({
  mode: 'or',
  filters: [],
  filterGroups: [
    {
      mode: 'and',
      filters: [{ key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] }],
      filterGroups: [],
    },
    {
      mode: 'and',
      filters: [
        { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['targets'] },
        { key: ['fromTypes'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] },
        { key: ['toTypes'], operator: 'eq', mode: 'or', values: ['Location', 'Sector', 'Vulnerability'] },
      ],
      filterGroups: [],
    },
    {
      mode: 'and',
      filters: [
        { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['uses'] },
        { key: ['fromTypes'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] },
        { key: ['toTypes'], operator: 'eq', mode: 'or', values: ['Attack-Pattern'] },
      ],
      filterGroups: [],
    },
  ],
});

const THREAT_TYPES = ['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual', 'Campaign'];

const relationshipGroup = (entityType: string, fromTypes: Array<string>, toTypes: Array<string>) => ({
  mode: 'and',
  filters: [
    { key: ['entity_type'], operator: 'eq', mode: 'or', values: [entityType] },
    { key: ['fromTypes'], operator: 'eq', mode: 'or', values: fromTypes },
    { key: ['toTypes'], operator: 'eq', mode: 'or', values: toTypes },
  ],
  filterGroups: [],
});

/** Admits everything the parser reads, except `uses` from a type left out of `usesFrom`. */
const threatFilter = (usesFrom: Array<string>) => JSON.stringify({
  mode: 'or',
  filters: [],
  filterGroups: [
    { mode: 'and', filters: [{ key: ['entity_type'], operator: 'eq', mode: 'or', values: THREAT_TYPES }], filterGroups: [] },
    relationshipGroup('targets', THREAT_TYPES, ['Location', 'Sector', 'Vulnerability']),
    relationshipGroup('uses', usesFrom, ['Attack-Pattern']),
    relationshipGroup('attributed-to', ['Campaign', 'Intrusion-Set'], ['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual']),
  ],
});

const ORIGIN_FILTER = JSON.stringify({
  mode: 'and',
  filters: [{ key: ['created_at'], operator: 'gt', mode: 'or', values: ['2026-01-01'] }],
  filterGroups: [],
});

describe('OpenCTI connector (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let adminId: string;
  let serviceAccountId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'OpenCTI Tenant' }, adminId);

    serviceAccountId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenCTI Bot' });
  });

  it('getSettings returns null before configuration', async () => {
    const res = await client.query('opencti.getSettings', undefined, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toBeNull();
  });

  it('configure then getSettings round-trips the stream/service-account, enabled by default', async () => {
    const configureRes = await client.mutation('opencti.configure', {
      streamId: 'live-stream-1',
      serviceAccountId,
    }, { tenantId });
    expect(configureRes.status).toBe(200);

    const res = await client.query('opencti.getSettings', undefined, { tenantId });
    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({
      streamId: 'live-stream-1',
      serviceAccountId,
      enabled: true,
      cursor: null,
    });
  });

  it('setEnabled toggles enabled without requiring prior configuration to be re-sent', async () => {
    await client.mutation('opencti.configure', {
      streamId: 'live-stream-1',
      serviceAccountId,
    }, { tenantId });

    const disableRes = await client.mutation('opencti.setEnabled', { enabled: false }, { tenantId });
    expect(disableRes.status).toBe(200);

    const res = await client.query('opencti.getSettings', undefined, { tenantId });
    expect(res.json.result.data.enabled).toBe(false);
  });

  it('reconfiguring resets a previously persisted cursor', async () => {
    await client.mutation('opencti.configure', {
      streamId: 'live-stream-1',
      serviceAccountId,
    }, { tenantId });
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .openctiConnector.updateCursor(tenantId, '1620249512318-0', new Date(), null, 0, 0);

    await client.mutation('opencti.configure', {
      streamId: 'live-stream-2',
      serviceAccountId,
    }, { tenantId });

    const res = await client.query('opencti.getSettings', undefined, { tenantId });
    expect(res.json.result.data).toMatchObject({ streamId: 'live-stream-2', cursor: null });
  });

  describe('opencti.setThreatVisibility', () => {
    it('should keep the stream where it was, nothing to replay for a reader-side choice', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
      await scoped.openctiConnector.updateCursor(tenantId, '1620249512318-0', new Date(), null, 0, 0);
      expect((await client.query('opencti.getSettings', undefined, { tenantId })).json.result.data.threatVisibility).toBe('per_member');

      const res = await client.mutation('opencti.setThreatVisibility', { threatVisibility: 'service_account' }, { tenantId });

      expect(res.status).toBe(200);
      expect((await client.query('opencti.getSettings', undefined, { tenantId })).json.result.data).toMatchObject({
        threatVisibility: 'service_account',
        streamId: 'live-stream-1',
        cursor: '1620249512318-0',
        streamGeneration: 0,
      });
    });

    it('should refuse a choice that is not one', async () => {
      const res = await client.mutation('opencti.setThreatVisibility', { threatVisibility: 'everyone' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should refuse a tenant member who cannot manage security', async () => {
      const regularUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, regularUser.userId);
      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('opencti.setThreatVisibility', { threatVisibility: 'service_account' }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });
  });

  it('configure rejects an unknown service account', async () => {
    const res = await client.mutation('opencti.configure', {
      streamId: 'live-stream-1',
      serviceAccountId: uuidv7(),
    }, { tenantId });

    expect(res.json.error).toBeTruthy();
    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  describe('connectors.reconnectStream', () => {
    it('reconnects a configured, enabled stream and clears the position it had', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
      // Generation 0 is the one a fresh `configure` inserts: under any other, the guarded update is a
      // no-op and the reconnect would be clearing a cursor that was never persisted.
      await scoped.openctiConnector.updateCursor(tenantId, '1', new Date('2026-06-01T00:00:00Z'), null, 40, 0);
      expect((await scoped.openctiConnector.getSettings(tenantId))?.cursor).toBe('1');

      const res = await client.mutation('connectors.reconnectStream', { source: 'opencti' }, { tenantId });

      expect(res.status).toBe(200);
      const settings = await scoped.openctiConnector.getSettings(tenantId);
      expect(settings?.cursor).toBeNull();
      expect(settings?.reachedLiveTailAt).not.toBeNull();
    });

    it('refuses a connector that runs as a job', async () => {
      const res = await client.mutation('connectors.reconnectStream', { source: 'drata' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('refuses a stream this tenant has not configured', async () => {
      const res = await client.mutation('connectors.reconnectStream', { source: 'opencti' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('refuses a stream whose service account has been deactivated, nothing being there to reconnect', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .serviceAccounts.updateServiceAccount(serviceAccountId, { active: false });

      const res = await client.mutation('connectors.reconnectStream', { source: 'opencti' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
      const settings = await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .openctiConnector.getSettings(tenantId);
      expect(settings?.reachedLiveTailAt).toBeNull();
    });

    it('refuses a tenant member who cannot manage security, the position being connector state', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      const regularUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, regularUser.userId);
      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('connectors.reconnectStream', { source: 'opencti' }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('refuses a stream that is switched off, turning one back on being the enable switch\'s', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      await client.mutation('opencti.setEnabled', { enabled: false }, { tenantId });

      const res = await client.mutation('connectors.reconnectStream', { source: 'opencti' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });
  });

  describe('connectors.getStreamState', () => {
    it('assembles the position, the counters and the mirrored total of a configured stream', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
      await scoped.openctiConnector
        .updateCursor(tenantId, '1620249512318-0', new Date('2026-06-01T00:00:00.000Z'), null, 40, 0);
      await scoped.openctiConnector
        .upsertStreamObject(tenantId, 'malware--0e2b3c1a-1c3a-4d4b-9f3a-2b6f2b6f2b6f', 'malware', { name: 'Emotet' });

      const res = await client.query('connectors.getStreamState', { source: 'opencti' }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toMatchObject({
        streamId: 'live-stream-1',
        cursor: '1620249512318-0',
        lastEventAt: '2026-06-01T00:00:00.000Z',
        historyStartAt: '2026-06-01T00:00:00.000Z',
        reachedLiveTail: false,
        backfillPercent: 0,
        objectsRead: 40,
        objectsHeld: 1,
      });
      expect(res.json.result.data.objectsReadAt).not.toBeNull();
    });

    it('refuses a connector that runs as a job and holds no stream', async () => {
      const res = await client.query('connectors.getStreamState', { source: 'drata' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });
  });

  describe('connectors.resetState', () => {
    it('refuses a tenant member who cannot manage security', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      const regularUser = await createUser(db);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId })
        .tenants.addTenantUser(tenantId, regularUser.userId);
      client.clearCookies();
      await signInAs(client, regularUser.userId);

      const res = await client.mutation('connectors.resetState', { source: 'opencti' }, { tenantId });

      expect(res.json.error.data.code).toBe('FORBIDDEN');
    });

    it('throws the whole stream position and both counters away', async () => {
      await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
      const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
      await scoped.openctiConnector
        .updateCursor(tenantId, '1', new Date('2026-06-01T00:00:00Z'), new Date(), 40, 0);
      expect((await scoped.openctiConnector.getSettings(tenantId))?.cursor).toBe('1');

      const res = await client.mutation('connectors.resetState', { source: 'opencti' }, { tenantId });

      expect(res.status).toBe(200);
      expect(await scoped.openctiConnector.getSettings(tenantId)).toMatchObject({
        cursor: null,
        lastEventAt: null,
        historyStartAt: null,
        backfillTargetAt: null,
        reachedLiveTailAt: null,
        objectsRead: 0,
        objectsReadAt: null,
      });
    });
  });

  it('listStreams fails with BAD_REQUEST when OpenCTI is not configured for the tenant', async () => {
    const res = await client.query('opencti.listStreams', undefined, { tenantId });

    expect(res.json.error).toBeTruthy();
    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  describe('listStreams against an answering OpenCTI', () => {
    let opencti: FakeOpenCtiGraphql;

    beforeEach(async () => {
      opencti = await startFakeOpenCtiGraphql([
        { id: 'stream-c', name: 'Charlie stopped', description: null, filters: null, origin_filters: null, stream_live: false },
        { id: 'stream-b', name: 'Beta actors', description: 'Actors and their claims', filters: PARTIAL_ACTOR_FILTER, origin_filters: null, stream_live: true },
        { id: 'stream-a', name: 'Alpha indicators', description: null, filters: INDICATOR_FILTER, origin_filters: ORIGIN_FILTER, stream_live: true },
        { id: 'stream-d', name: 'Delta complete', description: null, filters: SUPPLYING_FILTER, origin_filters: null, stream_live: true },
        { id: 'stream-e', name: 'Echo every threat', description: null, filters: threatFilter(THREAT_TYPES), origin_filters: null, stream_live: true },
        {
          id: 'stream-f',
          name: 'Foxtrot campaigns without techniques',
          description: null,
          filters: threatFilter(['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual']),
          origin_filters: null,
          stream_live: true,
        },
      ]);
      testConnectorsConfig['opencti'] = { [tenantId]: { url: opencti.url, token: 'stream-token' } };
    });

    afterEach(async () => {
      delete testConnectorsConfig['opencti'];
      await opencti.close();
    });

    it('asks OpenCTI for the three fields the verdict is built from', async () => {
      await client.query('opencti.listStreams', undefined, { tenantId });

      expect(opencti.queries).toHaveLength(1);
      expect(opencti.queries[0]).toContain('filters');
      expect(opencti.queries[0]).toContain('origin_filters');
      expect(opencti.queries[0]).toContain('stream_live');
    });

    it('serialises a verdict and a replay flag against every stream, in name order', async () => {
      const res = await client.query('opencti.listStreams', undefined, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toMatchObject([
        { id: 'stream-a', name: 'Alpha indicators', verdict: 'no_actors', replaysHistory: false },
        { id: 'stream-b', name: 'Beta actors', verdict: 'incompatible', replaysHistory: true },
        { id: 'stream-c', name: 'Charlie stopped', verdict: 'stopped', replaysHistory: true },
        { id: 'stream-d', name: 'Delta complete', verdict: 'delivers', replaysHistory: true },
        { id: 'stream-e', name: 'Echo every threat', verdict: 'delivers', replaysHistory: true },
        { id: 'stream-f', name: 'Foxtrot campaigns without techniques', verdict: 'incompatible', replaysHistory: true },
      ]);
    });

    it('names which relationships a refused filter leaves out, so the notice can say what is lost', async () => {
      const res = await client.query('opencti.listStreams', undefined, { tenantId });

      // The fixture admits `targets` from an intrusion set with no destination constraint, so only
      // the techniques leg is refused.
      expect(res.json.result.data[1].missingRelationships).toEqual(['intrusion_set_uses_technique']);
      expect(res.json.result.data[3].missingRelationships).toEqual([]);
      expect(res.json.result.data[5].missingRelationships).toEqual(['campaign_uses_technique']);
    });

    it('hands the front a normalised clause tree, and the filter as OpenCTI stores it', async () => {
      const res = await client.query('opencti.listStreams', undefined, { tenantId });

      const beta = res.json.result.data[1];
      expect(beta.rawFilter).toBe(PARTIAL_ACTOR_FILTER);
      expect(beta.filterGroup).toEqual({
        mode: 'or',
        filters: [{ key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] }],
        filterGroups: [{
          mode: 'and',
          filters: [
            { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['targets'] },
            { key: ['fromTypes'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] },
          ],
          filterGroups: [],
        }],
      });
      // OpenCTI stores a confidence threshold as a number, and the front's clause tree is all strings.
      expect(res.json.result.data[0].filterGroup.filters[1]).toEqual({
        key: ['confidence'], operator: 'gte', mode: 'or', values: ['70'],
      });
    });

    it('leaves a stream that carries no filter with nothing to render', async () => {
      const res = await client.query('opencti.listStreams', undefined, { tenantId });

      expect(res.json.result.data[2]).toMatchObject({ rawFilter: null, filterGroup: null });
    });
  });

  it('getBackfillProgress reflects the mirror table count', async () => {
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .openctiConnector.upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a' });

    const res = await client.query('opencti.getBackfillProgress', undefined, { tenantId });
    expect(res.json.result.data).toMatchObject({ mirroredObjectCount: 1, isCatchingUp: false });
  });

  it('getBackfillProgress reports catching up immediately once enabled, before any cursor is persisted', async () => {
    await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });

    const res = await client.query('opencti.getBackfillProgress', undefined, { tenantId });
    expect(res.json.result.data).toMatchObject({ mirroredObjectCount: 0, isCatchingUp: true });
  });

  it('getBackfillProgress stops reporting catching up once the live tail has been reached', async () => {
    await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .openctiConnector.updateCursor(tenantId, '1', new Date(), new Date(), 0, 0);

    const res = await client.query('opencti.getBackfillProgress', undefined, { tenantId });
    expect(res.json.result.data).toMatchObject({ isCatchingUp: false });
  });

  it('getBackfillProgress exposes progressPercent once a cursor is persisted', async () => {
    await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .openctiConnector.updateCursor(tenantId, '1', new Date('2025-01-30T00:00:00.000Z'), null, 0, 0);

    const res = await client.query('opencti.getBackfillProgress', undefined, { tenantId });
    // historyStartAt latches to the very same first event, so progress starts at 0%.
    expect(res.json.result.data.progressPercent).toBe(0);
  });

  it('never lets progressPercent regress across polls, even during a stall', async () => {
    await client.mutation('opencti.configure', { streamId: 'live-stream-1', serviceAccountId }, { tenantId });
    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const historyStartAt = new Date();
    // First call anchors historyStartAt at this exact date; the second advances lastEventAt 500ms
    // past it, leaving a fixed `doneMs` window while `totalMs` (time since historyStartAt) keeps
    // growing on every later read: the raw computation would regress once enough real time
    // passes with no further progress, which is exactly the stall this test simulates.
    await services.withOrigin(origin).openctiConnector.updateCursor(tenantId, '1', historyStartAt, null, 0, 0);
    await services.withOrigin(origin).openctiConnector.updateCursor(tenantId, '2', new Date(historyStartAt.getTime() + 500), null, 0, 0);

    await new Promise((resolve) => setTimeout(resolve, 750));
    const first = await client.query('opencti.getBackfillProgress', undefined, { tenantId });
    const firstPercent: unknown = first.json.result.data.progressPercent;
    if (typeof firstPercent !== 'number') {
      throw new Error('expected progressPercent to be a number');
    }
    expect(firstPercent).toBeGreaterThan(0);

    // A genuine stall: no further cursor update, just real wall-clock time passing.
    await new Promise((resolve) => setTimeout(resolve, 750));
    const second = await client.query('opencti.getBackfillProgress', undefined, { tenantId });
    expect(second.json.result.data.progressPercent).toBeGreaterThanOrEqual(firstPercent);
  });
});
