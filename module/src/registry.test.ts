import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from './index';
import { createServices, defineRepository, defineService } from './index';

/**
 * Stands in for Drizzle's own nesting: `transaction()` on the instance opens a transaction, the same
 * call on a transaction handle opens a savepoint. Nothing here touches a database, since what is
 * under test is which handle `atomic` asks.
 */
const createFakeDb = () => {
  const opened: Array<string> = [];
  const handle = (opens: string): unknown => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      opened.push(opens);
      return callback(handle('savepoint'));
    },
  });
  return { opened, db: handle('transaction') };
};

const probeRepository = defineRepository({
  noop: () => Promise.resolve(undefined),
});

const innerService = defineService('probeInner', probeRepository).implement({
  run: async ({ atomic }, fail: boolean) => atomic(() => {
    if (fail) {
      throw new Error('inner');
    }
    return Promise.resolve('ok');
  }),
});

const outerService = defineService('probeOuter', probeRepository)
  .dependsOn(() => [innerService])
  .implement({
    run: async ({ atomic }, failInner: boolean) => atomic(async ({ deps }) => {
      try {
        await deps.probeInner.run(failInner);
      } catch {
        return 'inner failed, outer carried on';
      }
      return 'both ran';
    }),
  });

const buildServices = () => {
  const fake = createFakeDb();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a stand-in for the one method `atomic` uses, so the nesting is asserted without a database
  const services = createServices([outerService, innerService], fake.db as DrizzleDB).withOrigin({ type: 'system' });
  return { opened: fake.opened, services };
};

describe('service atomic scopes', () => {
  it('should open a transaction for a top-level atomic', async () => {
    const { opened, services } = buildServices();

    await expect(services.probeInner.run(false)).resolves.toBe('ok');

    expect(opened).toEqual(['transaction']);
  });

  /**
   * Without a scope of its own, a failing inner atomic aborts the statement block it shares with the
   * outer one, so a caller catching it would carry on inside a transaction Postgres has already
   * poisoned. A savepoint is what makes the catch mean what it reads as.
   */
  it('should open a savepoint for a nested atomic, so its failure is the caller to catch', async () => {
    const { opened, services } = buildServices();

    await expect(services.probeOuter.run(true)).resolves.toBe('inner failed, outer carried on');

    expect(opened).toEqual(['transaction', 'savepoint']);
  });

  it('should open one savepoint per nested atomic when they succeed', async () => {
    const { opened, services } = buildServices();

    await expect(services.probeOuter.run(false)).resolves.toBe('both ran');

    expect(opened).toEqual(['transaction', 'savepoint']);
  });
});
