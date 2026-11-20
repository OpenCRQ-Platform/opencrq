// A child process named after the process manager's own reserved name is indistinguishable from
// it on every sample, which costs the whole scrape on duplicate series.
export const findReservedProcessNameCollision = (processNames: Array<string>, reserved: string): string | undefined =>
  processNames.find((processName) => processName === reserved);
