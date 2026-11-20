import type { XtmOneRegistrationAttempt } from './xtm-one-reachability';
import { getLastRegistrationAttempt } from './xtm-one-reachability';

// No config or logger import: the edition router's tests run without a process configuration.

const ignore = (): void => undefined;

/**
 * Runs `task` one call at a time. A call made during a run waits for the next one, shared with every
 * call made meanwhile: the run in flight may have sent its request before what the caller wants
 * answered, such as a license installed in XTM One a moment ago.
 */
export const serializeRuns = (task: () => Promise<void>): (() => Promise<void>) => {
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const start = (): Promise<void> => {
    const run = Promise.resolve().then(task);
    inFlight = run;
    const release = (): void => {
      if (inFlight === run) {
        inFlight = null;
      }
    };
    run.then(release, release);
    return run;
  };

  return () => {
    if (inFlight === null) {
      return start();
    }
    queued ??= inFlight.then(ignore, ignore).then(() => {
      queued = null;
      // Whatever started since the previous run settled started after every call queued here.
      return inFlight ?? start();
    });
    return queued;
  };
};

let runRegistration: (() => Promise<void>) | null = null;

/** Set by the process that registers with XTM One, the only one whose check reaches it; `null` once it stops. */
export const provideRegistrationRun = (run: (() => Promise<void>) | null): void => {
  runRegistration = run;
};

/**
 * Registers with XTM One now and returns that attempt, once its answer is applied to the edition of
 * this process. `not_configured` where nothing registers, `not_sent` when the attempt recorded nothing,
 * since it failed before any request left.
 */
export const checkXtmOneRegistration = async (): Promise<XtmOneRegistrationAttempt | 'not_configured' | 'not_sent'> => {
  if (runRegistration === null) {
    return 'not_configured';
  }
  const before = getLastRegistrationAttempt()?.sequence ?? 0;
  await runRegistration();
  const attempt = getLastRegistrationAttempt();
  return attempt !== null && attempt.sequence > before ? attempt : 'not_sent';
};
