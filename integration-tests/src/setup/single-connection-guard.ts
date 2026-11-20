import pg from 'pg';
import { afterAll, afterEach } from 'vitest';

/*
 * pg 9 stops queueing a query sent to a client still running one, which is what a `Promise.all` of
 * queries does on a transaction. pg 8 still queues it and warns only from the third such query,
 * once per process, so this reads the client's state itself, on every query.
 */

interface ClientState {
  _activeQuery: unknown,
  _queryQueue: Array<unknown>,
  pipeline?: boolean,
}

type Query = (this: pg.Client, ...args: Array<unknown>) => unknown;

// A drizzle query is only sent when awaited, so its stack often stops at drizzle: the SQL is what locates it.
const sqlOf = (statement: unknown): string => {
  const text = typeof statement === 'object' && statement !== null && 'text' in statement ? statement.text : statement;
  return typeof text === 'string' ? text.slice(0, 500) : '(unknown statement)';
};

const VIOLATIONS = Symbol.for('integration-tests.single-connection-violations');

// Each test file re-evaluates this setup in the same fork, whose `pg` module is loaded once.
const holder = globalThis as typeof globalThis & { [VIOLATIONS]?: Array<string> };

const installGuard = (): Array<string> => {
  const violations: Array<string> = [];
  const query: Query = pg.Client.prototype.query;
  const guarded: Query = function (...args) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pg's private client state, read by this test guard alone
    const state = this as unknown as ClientState;
    // `_activeQuery` is `undefined`, not `null`, on a client that has not run anything yet.
    if (!state.pipeline && (Boolean(state._activeQuery) || state._queryQueue.length > 0)) {
      const { stackTraceLimit } = Error;
      Error.stackTraceLimit = 50;
      const { stack } = new Error('A query was sent to a database connection still running another one');
      Error.stackTraceLimit = stackTraceLimit;
      violations.push(`${sqlOf(args[0])}\n${stack ?? ''}`);
    }
    return query.apply(this, args);
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- forwards every overload of `query` unchanged
  pg.Client.prototype.query = guarded as typeof pg.Client.prototype.query;
  return violations;
};

const violations = holder[VIOLATIONS] ??= installGuard();

/** Hands over the violations recorded since the last call, so that a test can assert on them. */
export const takeSingleConnectionViolations = (): Array<string> => violations.splice(0);

const failOnViolations = () => {
  const found = takeSingleConnectionViolations();
  if (found.length > 0) {
    throw new Error(`${found.length} queries were sent to a database connection still running another one. Run them one after the other where they share a transaction.\n\n${found.join('\n\n')}`);
  }
};

afterEach(failOnViolations);
afterAll(failOnViolations);
