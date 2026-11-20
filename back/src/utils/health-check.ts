const HEALTH_STATUSES = ['FORKING', 'BOOTING', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'EXITED', 'ERROR'] as const;

export { HEALTH_STATUSES };

export type HealthStatus = typeof HEALTH_STATUSES[number];

const isHealthStatus = (s: unknown): s is HealthStatus =>
  typeof s === 'string' && HEALTH_STATUSES.some((v) => v === s);

export const sendHealthStatus = (status: HealthStatus) => {
  process.send?.({ type: 'heartbeat', time: Date.now(), status });
};

export const onHealthReport = (cb: (status: HealthStatus) => void) => (message: unknown) => {
  if (message !== null && typeof message === 'object' && 'type' in message && message.type === 'heartbeat') {
    if ('status' in message && isHealthStatus(message.status)) {
      cb(message.status);
    }
  }
};
