/**
 * How long the process manager waits for a child to stop on its own before it kills it. A child's
 * own shutdown waits are derived from it, so that none of them can outlast it.
 */
export const CHILD_STOP_DEADLINE_MS = 30_000;

/** When a child stops waiting for its engines and exits, before the process manager kills it. */
export const CHILD_EXIT_DEADLINE_MS = CHILD_STOP_DEADLINE_MS - 5_000;
