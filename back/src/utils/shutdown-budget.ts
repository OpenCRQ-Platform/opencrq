/**
 * A child's whole stop, inside the process manager's deadline: each wait ends one margin before the
 * next one starts cutting, so none of them can outlast it.
 */
const STEP_MARGIN_MS = 5_000;

/** How long the process manager waits for a child to stop on its own before it kills it. */
export const CHILD_STOP_DEADLINE_MS = 30_000;

/** When a child stops waiting for its engines and exits, before the process manager kills it. */
export const CHILD_EXIT_DEADLINE_MS = CHILD_STOP_DEADLINE_MS - STEP_MARGIN_MS;

/** How long the job runtime waits for its handlers to settle, leaving the engines' stop its margin. */
export const JOB_DRAIN_MS = CHILD_EXIT_DEADLINE_MS - STEP_MARGIN_MS;

/** How long the http server waits for the requests in flight before it closes their connections. */
export const HTTP_CLOSE_GRACE_MS = STEP_MARGIN_MS;
