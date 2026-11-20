import { describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from '@app/module';
import type { DescriptionPhaseDeps, DescriptionPhaseServices } from './openaev-description-phase';
import { OpenaevNotFoundError } from './openaev-api-client';
import { DESCRIPTION_FETCH_BUDGET, syncDescriptions } from './openaev-description-phase';

const { mockLogFromError } = vi.hoisted(() => ({ mockLogFromError: vi.fn() }));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logFromError: mockLogFromError,
    logTrace: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }),
}));

type Client = DescriptionPhaseDeps['client'];

const NOW = new Date('2026-10-06T12:00:00.000Z');
const CONNECTOR_ID = 'connector-1';
const OA_TENANT = 'oa-tenant-1';

const ids = (count: number, prefix = 'asset'): Array<string> => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

const makeHarness = (candidates: Array<string>, overrides: Partial<DescriptionPhaseDeps> = {}) => {
  const svc = {
    openaevConnector: {
      listDescriptionCandidates: vi.fn<DescriptionPhaseServices['openaevConnector']['listDescriptionCandidates']>()
        .mockImplementation(({ limit }) => Promise.resolve(candidates.slice(0, limit))),
      markDescriptionsFetched: vi.fn<DescriptionPhaseServices['openaevConnector']['markDescriptionsFetched']>().mockResolvedValue(undefined),
    },
    supportingAssets: {
      updateReportedOverviewFields: vi.fn<DescriptionPhaseServices['supportingAssets']['updateReportedOverviewFields']>().mockResolvedValue(undefined),
    },
  };
  const client = {
    getAssetOverview: vi.fn<Client['getAssetOverview']>().mockImplementation(
      (_tenantId, assetId) => Promise.resolve({ asset_id: assetId, asset_description: `About ${assetId}` }),
    ),
    findUsers: vi.fn<Client['findUsers']>().mockResolvedValue([]),
  };
  const controller = new AbortController();
  const deps: DescriptionPhaseDeps = {
    client,
    svc,
    connectorId: CONNECTOR_ID,
    openaevTenantId: OA_TENANT,
    budget: DESCRIPTION_FETCH_BUDGET,
    concurrency: 4,
    signal: controller.signal,
    now: () => NOW,
    ...overrides,
  };
  return { svc, client, deps, controller };
};

/** The entry the phase writes for an asset that has a description and nothing else. */
const described = (sourceAssetId: string, description: string | null, extra: { url?: string | null, linkedPerson?: string | null } = {}) =>
  ({ sourceAssetId, description, url: null, linkedPerson: null, ...extra });

const writtenEntries = (svc: ReturnType<typeof makeHarness>['svc']) =>
  svc.supportingAssets.updateReportedOverviewFields.mock.calls.flatMap(([input]) => input.entries);
const markedIds = (svc: ReturnType<typeof makeHarness>['svc']) =>
  svc.openaevConnector.markDescriptionsFetched.mock.calls.flatMap(([input]) => input.sourceAssetIds);

describe('syncDescriptions', () => {
  it('has a budget of 500 calls per run', () => {
    expect(DESCRIPTION_FETCH_BUDGET).toBe(500);
  });

  describe('candidates', () => {
    it('asks for the candidates of this connector and OpenAEV tenant, capped at the budget', async () => {
      const { svc, deps } = makeHarness([], { budget: 37 });

      await syncDescriptions(deps);

      expect(svc.openaevConnector.listDescriptionCandidates).toHaveBeenCalledExactlyOnceWith({
        connectorId: CONNECTOR_ID, openaevTenantId: OA_TENANT, limit: 37,
      });
    });

    it('fetches nothing and writes nothing when there is no candidate', async () => {
      const { svc, client, deps } = makeHarness([]);

      const result = await syncDescriptions(deps);

      expect(result).toEqual({ calls: 0 });
      expect(client.getAssetOverview).not.toHaveBeenCalled();
      expect(svc.supportingAssets.updateReportedOverviewFields).not.toHaveBeenCalled();
      expect(svc.openaevConnector.markDescriptionsFetched).not.toHaveBeenCalled();
    });

    it('does not even list the candidates when the budget is spent', async () => {
      const { svc, client, deps } = makeHarness(ids(3), { budget: 0 });

      const result = await syncDescriptions(deps);

      expect(result).toEqual({ calls: 0 });
      expect(svc.openaevConnector.listDescriptionCandidates).not.toHaveBeenCalled();
      expect(client.getAssetOverview).not.toHaveBeenCalled();
    });
  });

  describe('budget', () => {
    it('issues at most the budget of calls and reports them', async () => {
      const { client, deps } = makeHarness(ids(40), { budget: 12 });

      const result = await syncDescriptions(deps);

      expect(client.getAssetOverview).toHaveBeenCalledTimes(12);
      expect(result).toEqual({ calls: 12 });
    });

    it('spends a call on a candidate OpenAEV answers 404 for, and on one that fails', async () => {
      const { client, deps } = makeHarness(ids(3));
      client.getAssetOverview
        .mockRejectedValueOnce(new OpenaevNotFoundError('gone'))
        .mockRejectedValueOnce(new Error('boom'));

      const result = await syncDescriptions(deps);

      expect(result).toEqual({ calls: 3 });
    });

    it('covers a budget larger than one write batch, calling each candidate once', async () => {
      const candidates = ids(250);
      const { svc, client, deps } = makeHarness(candidates, { budget: 250 });

      const result = await syncDescriptions(deps);

      expect(result).toEqual({ calls: 250 });
      expect(client.getAssetOverview.mock.calls.map(([, assetId]) => assetId).toSorted()).toEqual(candidates.toSorted());
      expect(markedIds(svc).toSorted()).toEqual(candidates.toSorted());
      expect(svc.supportingAssets.updateReportedOverviewFields.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('order', () => {
    it('fetches in the order the service ranked the candidates', async () => {
      const { client, deps } = makeHarness(['never-fetched', 'fetched-long-ago', 'fetched-recently'], { concurrency: 1 });

      await syncDescriptions(deps);

      expect(client.getAssetOverview.mock.calls.map(([, assetId]) => assetId)).toEqual(['never-fetched', 'fetched-long-ago', 'fetched-recently']);
    });

    it('asks OpenAEV for each asset under the OpenAEV tenant it belongs to', async () => {
      const { client, deps } = makeHarness(['asset-1']);

      await syncDescriptions(deps);

      expect(client.getAssetOverview).toHaveBeenCalledExactlyOnceWith(OA_TENANT, 'asset-1');
    });
  });

  describe('what it writes', () => {
    it('writes the trimmed description of each asset, then marks it fetched', async () => {
      const { svc, client, deps } = makeHarness(['asset-1', 'asset-2']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => Promise.resolve({
        asset_id: assetId, asset_description: assetId === 'asset-1' ? '  The payroll application  ' : 'The wiki',
      }));

      await syncDescriptions(deps);

      expect(svc.supportingAssets.updateReportedOverviewFields).toHaveBeenCalledExactlyOnceWith({
        connectorId: CONNECTOR_ID,
        entries: [
          described('asset-1', 'The payroll application'),
          described('asset-2', 'The wiki'),
        ],
      });
      expect(svc.openaevConnector.markDescriptionsFetched).toHaveBeenCalledExactlyOnceWith({
        connectorId: CONNECTOR_ID, sourceAssetIds: ['asset-1', 'asset-2'], fetchedAt: NOW,
      });
    });

    it('writes a description emptied in OpenAEV as null, whether it is blank, null or absent', async () => {
      const { svc, client, deps } = makeHarness(['blank', 'null', 'absent']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => Promise.resolve(
        assetId === 'blank' ? { asset_id: assetId, asset_description: '   ' }
          : assetId === 'null' ? { asset_id: assetId, asset_description: null }
            : { asset_id: assetId },
      ));

      await syncDescriptions(deps);

      expect(writtenEntries(svc)).toEqual([
        described('blank', null),
        described('null', null),
        described('absent', null),
      ]);
      expect(markedIds(svc)).toEqual(['blank', 'null', 'absent']);
    });

    it('writes before it marks, so a crash in between fetches the asset again rather than losing its description', async () => {
      const { svc, deps } = makeHarness(['asset-1']);

      await syncDescriptions(deps);

      expect(svc.supportingAssets.updateReportedOverviewFields.mock.invocationCallOrder[0])
        .toBeLessThan(svc.openaevConnector.markDescriptionsFetched.mock.invocationCallOrder[0]);
    });

    it('writes one batch before it fetches the next', async () => {
      const candidates = ids(250);
      const { svc, client, deps } = makeHarness(candidates, { budget: 250 });

      await syncDescriptions(deps);

      const firstWrite = svc.supportingAssets.updateReportedOverviewFields.mock.invocationCallOrder[0];
      const callsBeforeFirstWrite = client.getAssetOverview.mock.invocationCallOrder.filter((order) => order < firstWrite);
      expect(callsBeforeFirstWrite.length).toBeGreaterThan(0);
      expect(callsBeforeFirstWrite.length).toBeLessThan(250);
    });
  });

  describe('url and linked person', () => {
    const overviewOf = (assetId: string, over: Record<string, string | null> = {}) => ({ asset_id: assetId, asset_description: `About ${assetId}`, ...over });

    it('writes the url as OpenAEV serves it, and null when it is absent or null', async () => {
      const { svc, client, deps } = makeHarness(['with-url', 'null-url', 'no-url']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => Promise.resolve(
        assetId === 'with-url' ? overviewOf(assetId, { asset_url: 'https://payroll.test' })
          : assetId === 'null-url' ? overviewOf(assetId, { asset_url: null })
            : overviewOf(assetId),
      ));

      await syncDescriptions(deps);

      expect(writtenEntries(svc).map((entry) => [entry.sourceAssetId, entry.url])).toEqual([
        ['with-url', 'https://payroll.test'], ['null-url', null], ['no-url', null],
      ]);
    });

    it('resolves the linked person to a name through one findUsers call for the whole batch', async () => {
      const { svc, client, deps } = makeHarness(['asset-1', 'asset-2', 'asset-3']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => Promise.resolve(
        assetId === 'asset-3' ? overviewOf(assetId) : overviewOf(assetId, { asset_linked_person: 'user-1' }),
      ));
      client.findUsers.mockResolvedValue([{ user_id: 'user-1', user_email: 'ada@acme.test', user_firstname: 'Ada', user_lastname: 'Lovelace' }]);

      await syncDescriptions(deps);

      expect(client.findUsers).toHaveBeenCalledExactlyOnceWith(OA_TENANT, ['user-1']);
      expect(writtenEntries(svc).map((entry) => [entry.sourceAssetId, entry.linkedPerson])).toEqual([
        ['asset-1', 'Ada Lovelace'], ['asset-2', 'Ada Lovelace'], ['asset-3', null],
      ]);
    });

    it('falls back to the email, then to nothing, as the inventory does', async () => {
      const { svc, client, deps } = makeHarness(['asset-1', 'asset-2']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => Promise.resolve(
        overviewOf(assetId, { asset_linked_person: assetId === 'asset-1' ? 'user-mail-only' : 'user-gone' }),
      ));
      client.findUsers.mockResolvedValue([{ user_id: 'user-mail-only', user_email: 'ada@acme.test' }]);

      await syncDescriptions(deps);

      expect(writtenEntries(svc).map((entry) => entry.linkedPerson)).toEqual(['ada@acme.test', null]);
    });

    it('asks for no user when no asset of the batch has a linked person', async () => {
      const { client, deps } = makeHarness(['asset-1']);

      await syncDescriptions(deps);

      expect(client.findUsers).not.toHaveBeenCalled();
    });

    it('asks once per batch, not once per run', async () => {
      const { client, deps } = makeHarness(ids(250), { budget: 250 });
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => Promise.resolve(overviewOf(assetId, { asset_linked_person: 'user-1' })));

      await syncDescriptions(deps);

      expect(client.findUsers).toHaveBeenCalledTimes(3);
    });

    it('treats the assets with a linked person as failed when the directory cannot be read, writing the others', async () => {
      const { svc, client, deps } = makeHarness(['asset-1', 'asset-2', 'asset-3']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => Promise.resolve(
        assetId === 'asset-1' ? overviewOf(assetId, { asset_linked_person: 'user-1' }) : overviewOf(assetId),
      ));
      client.findUsers.mockRejectedValue(new Error('directory unavailable'));
      mockLogFromError.mockClear();

      await expect(syncDescriptions(deps)).resolves.toEqual({ calls: 3 });

      expect(mockLogFromError).toHaveBeenCalledOnce();
      expect(writtenEntries(svc).map((entry) => entry.sourceAssetId)).toEqual(['asset-2', 'asset-3']);
      expect(markedIds(svc).toSorted()).toEqual(['asset-1', 'asset-2', 'asset-3']);
    });

    it('writes a url and a linked person emptied in OpenAEV as null', async () => {
      const { svc, deps } = makeHarness(['asset-1']);

      await syncDescriptions(deps);

      expect(writtenEntries(svc)).toEqual([described('asset-1', 'About asset-1', { url: null, linkedPerson: null })]);
    });
  });

  describe('an asset OpenAEV does not know', () => {
    it('is marked fetched and nothing is written for it', async () => {
      const { svc, client, deps } = makeHarness(['asset-1', 'asset-gone']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => (
        assetId === 'asset-gone'
          ? Promise.reject(new OpenaevNotFoundError('not found'))
          : Promise.resolve({ asset_id: assetId, asset_description: 'Still here' })
      ));

      await syncDescriptions(deps);

      expect(writtenEntries(svc)).toEqual([described('asset-1', 'Still here')]);
      expect(markedIds(svc).toSorted()).toEqual(['asset-1', 'asset-gone']);
    });

    it('marks it fetched even when every candidate of the batch is gone, writing nothing at all', async () => {
      const { svc, client, deps } = makeHarness(['gone-1', 'gone-2']);
      client.getAssetOverview.mockRejectedValue(new OpenaevNotFoundError('not found'));

      await syncDescriptions(deps);

      expect(svc.supportingAssets.updateReportedOverviewFields).not.toHaveBeenCalled();
      expect(markedIds(svc)).toEqual(['gone-1', 'gone-2']);
    });
  });

  describe('any other failure', () => {
    it('is logged and stamped as attempted without a write, while the other assets are written and marked', async () => {
      const { svc, client, deps } = makeHarness(['asset-1', 'asset-broken', 'asset-3']);
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => (
        assetId === 'asset-broken'
          ? Promise.reject(new Error('OpenAEV answered 500'))
          : Promise.resolve({ asset_id: assetId, asset_description: `About ${assetId}` })
      ));

      await expect(syncDescriptions(deps)).resolves.toEqual({ calls: 3 });

      expect(mockLogFromError).toHaveBeenCalledWith(expect.any(Error), expect.any(String), expect.objectContaining({ openaevTenantId: OA_TENANT, sourceAssetId: 'asset-broken' }));
      expect(writtenEntries(svc).map((entry) => entry.sourceAssetId).toSorted()).toEqual(['asset-1', 'asset-3']);
      expect(markedIds(svc).toSorted()).toEqual(['asset-1', 'asset-3', 'asset-broken']);
    });

    it('sends a permanently failing asset to the back of the queue, so it cannot hold the budget run after run', async () => {
      // Another answered asset in the batch is what tells a failing asset from a failing OpenAEV.
      const { svc, client, deps } = makeHarness(['asset-broken', 'asset-fine'], { concurrency: 1 });
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => (
        assetId === 'asset-broken' ? Promise.reject(new Error('OpenAEV answered 500')) : Promise.resolve({ asset_id: assetId })
      ));

      await syncDescriptions(deps);

      expect(svc.openaevConnector.markDescriptionsFetched).toHaveBeenCalledExactlyOnceWith({
        connectorId: CONNECTOR_ID, sourceAssetIds: ['asset-fine', 'asset-broken'], fetchedAt: NOW,
      });
    });

    it('does not fail the run when OpenAEV refuses a call (a non-retryable error is logged like any other)', async () => {
      const { client, deps } = makeHarness(['asset-1']);
      client.getAssetOverview.mockRejectedValue(new NonRetryableError('OpenAEV auth error (403)'));

      await expect(syncDescriptions(deps)).resolves.toEqual({ calls: 1 });
    });

    it('ends the phase after a batch in which nothing was answered, instead of spending the whole budget', async () => {
      const { svc, client, deps } = makeHarness(ids(400), { budget: 400 });
      client.getAssetOverview.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const result = await syncDescriptions(deps);

      expect(result.calls).toBeLessThan(400);
      expect(client.getAssetOverview).toHaveBeenCalledTimes(result.calls);
      expect(svc.openaevConnector.markDescriptionsFetched).not.toHaveBeenCalled();
    });

    it('stamps none of the assets of the batch the breaker cut: OpenAEV being down is not the asset\'s fault', async () => {
      const { svc, client, deps } = makeHarness(ids(400), { budget: 400 });
      client.getAssetOverview.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await syncDescriptions(deps);

      expect(markedIds(svc)).toEqual([]);
      expect(writtenEntries(svc)).toEqual([]);
    });

    it('goes on after a batch in which some calls failed and others were answered', async () => {
      const candidates = ids(250);
      const { client, svc, deps } = makeHarness(candidates, { budget: 250 });
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => (
        Number(assetId.split('-')[1]) % 2 === 0
          ? Promise.reject(new Error('flaky'))
          : Promise.resolve({ asset_id: assetId, asset_description: 'ok' })
      ));

      const result = await syncDescriptions(deps);

      expect(result).toEqual({ calls: 250 });
      expect(writtenEntries(svc)).toHaveLength(125);
      expect(markedIds(svc)).toHaveLength(250);
    });
  });

  describe('concurrency', () => {
    it('never has more calls in flight than the cap, and does run them side by side', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const { client, deps } = makeHarness(ids(20), { concurrency: 3 });
      client.getAssetOverview.mockImplementation(async (_tenantId, assetId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => {
          setTimeout(resolve, 2);
        });
        inFlight -= 1;
        return { asset_id: assetId, asset_description: 'ok' };
      });

      await syncDescriptions(deps);

      expect(maxInFlight).toBe(3);
    });
  });

  describe('abort', () => {
    it('starts nothing when already aborted', async () => {
      const { svc, client, deps, controller } = makeHarness(ids(5));
      controller.abort();

      const result = await syncDescriptions(deps);

      expect(result).toEqual({ calls: 0 });
      expect(client.getAssetOverview).not.toHaveBeenCalled();
      expect(svc.openaevConnector.markDescriptionsFetched).not.toHaveBeenCalled();
    });

    it('stops fetching once aborted, and writes and marks only what was fetched', async () => {
      const { svc, client, deps, controller } = makeHarness(ids(10), { concurrency: 1 });
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => {
        if (assetId === 'asset-2') {
          controller.abort();
        }
        return Promise.resolve({ asset_id: assetId, asset_description: `About ${assetId}` });
      });

      const result = await syncDescriptions(deps);

      expect(result).toEqual({ calls: 3 });
      expect(writtenEntries(svc).map((entry) => entry.sourceAssetId)).toEqual(['asset-0', 'asset-1', 'asset-2']);
      expect(markedIds(svc)).toEqual(['asset-0', 'asset-1', 'asset-2']);
    });

    it('does not mark a call the abort cut short, nor log it as a failure of the asset', async () => {
      const { svc, client, deps, controller } = makeHarness(['asset-1', 'asset-2'], { concurrency: 1 });
      mockLogFromError.mockClear();
      client.getAssetOverview.mockImplementation((_tenantId, assetId) => {
        if (assetId === 'asset-2') {
          controller.abort();
          return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
        }
        return Promise.resolve({ asset_id: assetId, asset_description: 'ok' });
      });

      await syncDescriptions(deps);

      expect(markedIds(svc)).toEqual(['asset-1']);
      expect(mockLogFromError).not.toHaveBeenCalled();
    });

    it('starts no further batch once aborted during a write', async () => {
      const { svc, client, deps, controller } = makeHarness(ids(250), { budget: 250 });
      svc.supportingAssets.updateReportedOverviewFields.mockImplementation(() => {
        controller.abort();
        return Promise.resolve();
      });

      const result = await syncDescriptions(deps);

      expect(result.calls).toBeLessThan(250);
      expect(client.getAssetOverview).toHaveBeenCalledTimes(result.calls);
      expect(markedIds(svc)).toHaveLength(result.calls);
    });
  });

  describe('progress', () => {
    it('reports the assets processed out of the candidates it set out to fetch, once per batch', async () => {
      const onProgress = vi.fn<NonNullable<DescriptionPhaseDeps['onProgress']>>().mockResolvedValue(undefined);
      const { deps } = makeHarness(ids(250), { budget: 250, onProgress });

      await syncDescriptions(deps);

      const reports = onProgress.mock.calls.map(([progress]) => progress);
      expect(reports.length).toBeGreaterThan(1);
      expect(reports.every((progress) => progress.total === 250)).toBe(true);
      expect(reports.map((progress) => progress.processed)).toEqual(reports.map((progress) => progress.processed).toSorted((a, b) => a - b));
      expect(reports.at(-1)?.processed).toBe(250);
    });

    it('reports nothing when there is nothing to fetch', async () => {
      const onProgress = vi.fn<NonNullable<DescriptionPhaseDeps['onProgress']>>().mockResolvedValue(undefined);
      const { deps } = makeHarness([], { onProgress });

      await syncDescriptions(deps);

      expect(onProgress).not.toHaveBeenCalled();
    });
  });
});
