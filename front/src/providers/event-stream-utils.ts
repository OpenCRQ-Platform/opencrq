export interface Doorbell {
  procedures: ReadonlyArray<string>,
  all: boolean,
}

export interface DoorbellInvalidation {
  /** The tRPC query key prefix of one procedure, absent when every query is stale. */
  queryKey?: [Array<string>],
  refetchType: 'active' | 'none',
}

/**
 * The invalidations a doorbell asks of the query cache. A tRPC query key starts with the split
 * procedure path, so one prefix covers every input of the procedure. A hidden document only marks
 * its queries stale: the refetch-on-focus of the query client fetches them when the tab is shown
 * again, so a background tab sends nothing on a doorbell.
 */
export const planDoorbellInvalidations = (doorbell: Doorbell, documentHidden: boolean): Array<DoorbellInvalidation> => {
  const refetchType = documentHidden ? 'none' : 'active';
  if (doorbell.all) {
    return [{ refetchType }];
  }
  return doorbell.procedures.map((procedure) => ({ queryKey: [procedure.split('.')], refetchType }));
};

/** One doorbell standing for both: every table if either stands for every table, else the procedures of both. */
const mergeDoorbells = (a: Doorbell, b: Doorbell): Doorbell => (a.all || b.all
  ? { procedures: [], all: true }
  : { procedures: [...new Set([...a.procedures, ...b.procedures])], all: false });

/** A request has no timeout, so a hold whose work never ends would stop every refresh of the page for good. */
const MAX_DOORBELL_HOLD_MS = 15_000;
/**
 * The server rings for a write at the end of its throttle window, so after the write's response.
 * Covers the `events.doorbell_window_ms` default of 100 ms: an operator raising it past 300 ms gets
 * a second refresh after a held save again.
 */
const DOORBELL_SETTLE_MS = 300;

export interface DoorbellGate {
  ring: (doorbell: Doorbell) => void,
  /**
   * Holds the doorbells until the returned release is called, or `maxHoldMs` has passed, then
   * `settleMs` more, and delivers them as one.
   */
  hold: () => () => void,
}

/**
 * Passes doorbells through, except while held. A save of several calls holds them, so the page
 * refreshes once after its last call: each call rings on its own, and each refresh redraws the page.
 */
export const createDoorbellGate = (
  deliver: (doorbell: Doorbell) => void,
  maxHoldMs = MAX_DOORBELL_HOLD_MS,
  settleMs = DOORBELL_SETTLE_MS,
): DoorbellGate => {
  let holds = 0;
  let held: Doorbell | null = null;
  let settling: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    settling = null;
    if (held !== null) {
      const doorbell = held;
      held = null;
      deliver(doorbell);
    }
  };
  return {
    ring: (doorbell) => {
      if (holds === 0 && settling === null) {
        deliver(doorbell);
        return;
      }
      held = held === null ? doorbell : mergeDoorbells(held, doorbell);
    },
    hold: () => {
      holds += 1;
      if (settling !== null) {
        clearTimeout(settling);
        settling = null;
      }
      let released = false;
      const release = () => {
        if (released) {
          return;
        }
        released = true;
        clearTimeout(ceiling);
        holds -= 1;
        if (holds === 0) {
          settling = setTimeout(flush, settleMs);
        }
      };
      const ceiling = setTimeout(release, maxHoldMs);
      return release;
    },
  };
};
