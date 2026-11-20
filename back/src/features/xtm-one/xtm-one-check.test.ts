import { afterEach, describe, expect, it } from 'vitest';
import { checkXtmOneRegistration, provideRegistrationRun, serializeRuns } from './xtm-one-check';
import { recordRegistrationFailure, recordRegistrationSuccess, resetXtmOneReachability } from './xtm-one-reachability';

interface Gate {
  promise: Promise<void>,
  open: () => void,
  fail: (error: Error) => void,
}

const gate = (): Gate => {
  let open = (): void => undefined;
  let fail = (_error: Error): void => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
};

const gatedTask = () => {
  const gates: Array<Gate> = [];
  let running = 0;
  let maxRunning = 0;
  const task = async (): Promise<void> => {
    const own = gate();
    gates.push(own);
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    try {
      await own.promise;
    } finally {
      running -= 1;
    }
  };
  return { task, gates, maxRunning: () => maxRunning };
};

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve();
  }
};

describe('serializeRuns', () => {
  it('starts a run on a call made while none is in flight', async () => {
    const { task, gates } = gatedTask();
    const run = serializeRuns(task);

    const first = run();
    await settle();
    gates[0]?.open();

    await expect(first).resolves.toBeUndefined();
    expect(gates).toHaveLength(1);
  });

  it('answers a call made during a run with the run after it, never the one in flight', async () => {
    const { task, gates, maxRunning } = gatedTask();
    const run = serializeRuns(task);

    const first = run();
    await settle();
    let secondDone = false;
    const second = run().then(() => {
      secondDone = true;
    });
    gates[0]?.open();
    await first;
    await settle();

    expect(secondDone).toBe(false);
    expect(gates).toHaveLength(2);
    gates[1]?.open();
    await second;
    expect(maxRunning()).toBe(1);
  });

  it('shares one following run among every call made during a run', async () => {
    const { task, gates } = gatedTask();
    const run = serializeRuns(task);

    const first = run();
    await settle();
    const followers = [run(), run(), run()];
    gates[0]?.open();
    await first;
    await settle();
    gates[1]?.open();
    await Promise.all(followers);

    expect(gates).toHaveLength(2);
  });

  it('keeps serving after a run fails, and rejects only that run\'s callers', async () => {
    const { task, gates } = gatedTask();
    const run = serializeRuns(task);

    const first = run();
    await settle();
    const second = run();
    gates[0]?.fail(new Error('registration failed'));

    await expect(first).rejects.toThrow('registration failed');
    await settle();
    gates[1]?.open();
    await expect(second).resolves.toBeUndefined();
  });
});

describe('checkXtmOneRegistration', () => {
  afterEach(() => {
    provideRegistrationRun(null);
    resetXtmOneReachability();
  });

  it('reports not_configured where nothing registers', async () => {
    await expect(checkXtmOneRegistration()).resolves.toBe('not_configured');
  });

  it('returns the attempt the run made, with its own outcome', async () => {
    provideRegistrationRun(() => {
      recordRegistrationFailure('refused', 1_000);
      return Promise.resolve();
    });

    await expect(checkXtmOneRegistration()).resolves.toEqual({ sequence: 1, outcome: 'refused', failingSince: 1_000 });
  });

  it('reports a refusal even right after a success, where the reachability still says ok', async () => {
    recordRegistrationSuccess(1_000);
    provideRegistrationRun(() => {
      recordRegistrationFailure('unreachable', 2_000);
      return Promise.resolve();
    });

    await expect(checkXtmOneRegistration()).resolves.toMatchObject({ outcome: 'unreachable', failingSince: 2_000 });
  });

  it('reports not_sent when the run recorded no attempt, rather than the previous one', async () => {
    recordRegistrationSuccess(1_000);
    provideRegistrationRun(() => Promise.resolve());

    await expect(checkXtmOneRegistration()).resolves.toBe('not_sent');
  });
});
