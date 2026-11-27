import { InputsNotReadyError, NonRetryableError, openctiConnectorSettings } from '@app/module';
import { createJobContext } from '@app/back/src/engines/job-runtime/job-context-factory';
import { normaliseUrl } from '@app/back/src/features/deployment-integrations/deployment-integrations';
import { managedStreamVersion } from '@app/back/src/features/deployment-integrations/opencti-managed-stream';
import { openctiDeploymentStreamHandler } from '@app/back/src/features/deployment-integrations/opencti-deployment-stream-handler';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeOpenCtiGraphql } from '../../helpers/fake-opencti-graphql';
import { startFakeOpenCtiGraphql } from '../../helpers/fake-opencti-graphql';
import { createTenantWithAdmin } from '../../helpers/factories';
import { testConnectorsConfig } from '../../setup/mock';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The handler builds its services on the backend's own db engine, which reads the connection from
// `config()`: this file's mock must therefore carry the worker database next to the connectors that
// `setup/mock.ts` otherwise serves.
vi.mock('../../../../back/src/config', async () => {
  const { getWorkerDbName, pgConfig } = await import('../../setup/pg-config');
  const { testConnectorsConfig: connectors } = await import('../../setup/mock');
  return {
    config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() }, connectors }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const services = createTestServices(db);
const system = () => services.withOrigin({ type: 'system' }).openctiConnector;

describe('OpenCTI deployment stream handler, against a fake OpenCTI', () => {
  let tenantId: string;
  let fake: FakeOpenCtiGraphql | undefined;

  const provide = (url: string) => {
    testConnectorsConfig.opencti = { [tenantId]: { url, token: 'tok' } };
  };

  const run = (signal: AbortSignal = new AbortController().signal) => openctiDeploymentStreamHandler(createJobContext({
    jobId: uuidv7(),
    tenantId,
    kind: 'opencti-deployment-stream',
    interactive: false,
    payload: {},
    attempt: 1,
    state: null,
    signal,
    deps: {
      updateProgress: () => Promise.resolve(),
      saveStateSnapshot: () => Promise.resolve(),
    },
  }));

  const settingsRow = async () =>
    (await db.select().from(openctiConnectorSettings).where(eq(openctiConnectorSettings.tenantId, tenantId)))[0];

  beforeEach(async () => {
    await truncateAllTables(db);
    tenantId = (await createTenantWithAdmin(services)).tenantId;
  });

  afterEach(async () => {
    delete testConnectorsConfig.opencti;
    await fake?.close();
    fake = undefined;
  });

  it('creates the managed stream and binds the tenant to it as the deployment', async () => {
    fake = await startFakeOpenCtiGraphql([]);
    provide(fake.url);

    await run();

    expect(fake.streams).toHaveLength(1);
    expect(managedStreamVersion(fake.streams[0].description ?? null)).not.toBeNull();
    expect(await settingsRow()).toMatchObject({ streamId: fake.streams[0].id, enabled: true, boundByDeployment: true });
  });

  it('fails for good when the deployment provides no OpenCTI for the tenant', async () => {
    await expect(run()).rejects.toBeInstanceOf(NonRetryableError);
  });

  it('defers while another run provisions the managed stream of the same OpenCTI', async () => {
    fake = await startFakeOpenCtiGraphql([]);
    provide(fake.url);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const other = system().withManagedStreamLock(normaliseUrl(fake.url), () => {
      held();
      return released;
    });
    await holding;

    try {
      await expect(run()).rejects.toBeInstanceOf(InputsNotReadyError);
      expect(fake.queries).toHaveLength(0);
    } finally {
      release();
      await other;
    }
    expect(await settingsRow()).toBeUndefined();
  });

  it('stops its OpenCTI calls when the run is cancelled', async () => {
    fake = await startFakeOpenCtiGraphql([], { stall: true });
    provide(fake.url);
    const controller = new AbortController();

    const started = Date.now();
    const running = run(controller.signal);
    await vi.waitFor(() => expect(fake?.queries).toHaveLength(1));
    controller.abort();

    await expect(running).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await settingsRow()).toBeUndefined();
  });
});
