export interface RunningEngine {
  key: string,
  onEnginesStopping?: () => void | Promise<void>,
  stop?: () => void | Promise<void>,
  stopsLast?: boolean,
}

/** Lets every engine finish its stopping wait, then stops them, the `stopsLast` ones once all the others have stopped. */
export const stopEngines = async (engines: Array<RunningEngine>, onStopped: (key: string) => void): Promise<void> => {
  await Promise.all(engines.map(({ onEnginesStopping }) => onEnginesStopping?.()));
  const stopEngine = async ({ key, stop }: RunningEngine): Promise<void> => {
    await stop?.();
    onStopped(key);
  };
  await Promise.all(engines.filter(({ stopsLast }) => !stopsLast).map(stopEngine));
  await Promise.all(engines.filter(({ stopsLast }) => stopsLast).map(stopEngine));
};

/** Calls `onExpired` once `deadlineMs` has passed, without holding the process open until then. */
export const armExitDeadline = (deadlineMs: number, onExpired: () => void): NodeJS.Timeout =>
  setTimeout(onExpired, deadlineMs).unref();
