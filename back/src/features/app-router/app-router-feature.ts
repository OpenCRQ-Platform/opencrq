import { dbEngine } from '../../engines/db';
import { filigranTelemetryEngine } from '../../engines/filigran-telemetry';
import { httpServerEngine } from '../../engines/http-server';
import { registerFeature } from '../features-manager';
import { appRouter } from './app-router-router';
import { servedProcedureManifest } from './served-procedure-manifest';

const APP_ROUTER_FEATURE_KEY = 'app-router';

const activateAppRouter = () => {
  const { db, checkConnection } = dbEngine;

  httpServerEngine.registerRouter(({ publicProcedure }) => appRouter({ publicProcedure }, db, checkConnection, {
    // Anonymous usage telemetry hooks (feature activation counts only) -
    // injected here so the tRPC routers stay engine-free.
    onRiskScenarioCreated: () => filigranTelemetryEngine.addRiskScenarioCreatedCount(),
    onCrqSimulationLaunched: () => filigranTelemetryEngine.addCrqSimulationLaunchedCount(),
    onConnectorSyncLaunched: () => filigranTelemetryEngine.addConnectorSyncLaunchedCount(),
  }, servedProcedureManifest));
};

registerFeature({
  key: APP_ROUTER_FEATURE_KEY,
  activate: activateAppRouter,
});
