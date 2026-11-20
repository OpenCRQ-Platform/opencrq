import type { Feature } from '../features';
import type { HealthStatus } from '../utils/health-check';
import { config } from '../config';
import { listEngines, sealEngineRegistration } from '../engines/engines-manager';
import { isFeatureEnabled } from '../features/feature-flags/feature-flags';
import { listFeatures } from '../features';
import { sendHealthStatus } from '../utils/health-check';
import { createLogger } from '../utils/logger';
import { platformVersion } from '../utils/platform-version';

const logger = createLogger({ engine: 'boot' });
const { logTrace, logFromError, logFromFatalError } = logger;

let status: HealthStatus = 'BOOTING';
let lastLogStatusTime = 0;

logTrace('Server is initializing', {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  dev: config().inDev,
  nodejs: process.version,
  version: platformVersion(),
});

const reportHealthStatus = (newStatus?: HealthStatus) => {
  const previousStatus = status;
  if (newStatus) {
    status = newStatus;
  }
  if (newStatus || (Date.now() - lastLogStatusTime) > (60 * 60 * 1000)) {
    logTrace('Process status', { status, previousStatus });
    lastLogStatusTime = Date.now();
  }
  sendHealthStatus(status);
};

reportHealthStatus();
setInterval(reportHealthStatus, 5000).unref();

export const boot = () => {
  process.on('uncaughtException', (error) => {
    logFromFatalError(error, 'Uncaught exception');
  });

  process.on('unhandledRejection', (reason) => {
    logFromFatalError(reason, 'Unhandled rejection');
  });

  const abortController = new AbortController();

  const isHeldBackByItsFlag = ({ featureFlag }: Feature) => featureFlag !== undefined && !isFeatureEnabled(featureFlag);
  const features = listFeatures();
  const heldFeatures = features.filter(isHeldBackByItsFlag);
  const activatedFeatures = features
    .filter((feature) => !isHeldBackByItsFlag(feature))
    .map(({ key, activate }) => {
      activate(abortController.signal);
      return key;
    });
  logTrace('Features activated', { keys: activatedFeatures });
  if (heldFeatures.length > 0) {
    logTrace('Features held behind a disabled feature flag', {
      features: heldFeatures.map(({ key, featureFlag }) => ({ key, featureFlag })),
    });
  }

  // list engines enabled by features activation
  const enabledEngines = listEngines();
  logTrace('Starting engines', { engines: enabledEngines.map(({ key }) => key) });

  reportHealthStatus('STARTING');

  // start enabled engines asynchronously
  const runningEnginesPromise = (async () => {
    try {
      const runningEngines = await Promise.all(enabledEngines.map(async ({ key, start }) => {
        const { onEnginesStarted, onEnginesStopping, stop } = await start(abortController.signal);
        logTrace('Engine is started', { key });
        return { key, onEnginesStarted, onEnginesStopping, stop };
      }));

      sealEngineRegistration();

      await Promise.all(runningEngines.map(({ onEnginesStarted }) => onEnginesStarted?.()));
      logTrace('Engines started');
      reportHealthStatus('RUNNING');
      return runningEngines;
    } catch (e) {
      reportHealthStatus('STOPPED');
      return logFromFatalError(e, 'Engines start error');
    }
  })();

  const stopProcess = async () => {
    let exitCode = 1;
    try {
      abortController.abort();
      const runningEngines = await runningEnginesPromise;
      reportHealthStatus('STOPPING');
      logTrace('Stopping engines', { engines: runningEngines.map(({ key }) => key) });
      await Promise.all(runningEngines.map(({ onEnginesStopping }) => onEnginesStopping?.()));
      await Promise.all(runningEngines.map(async ({ key, stop }) => {
        await stop?.();
        logTrace('Engine is stopped', { key });
      }));
      exitCode = 0;
    } catch (e) {
      logFromError(e, 'Engines stop error');
    } finally {
      reportHealthStatus('STOPPED');
      logTrace('Server has been stopped');
      process.exit(exitCode);
    }
  };

  let stopping = false;
  ['SIGTERM', 'SIGINT', 'message'].forEach((signal) => {
    process.on(signal, (message) => {
      if (signal !== 'message' || message === 'shutdown') {
        if (!stopping) {
          stopping = true;
          logTrace(`${signal === 'message' ? 'shutdown message' : signal} signal received, stopping the server...`);
          stopProcess();
        }
      }
    });
  });
};
