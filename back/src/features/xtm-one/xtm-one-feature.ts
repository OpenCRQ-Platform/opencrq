import { createServices, jobsService } from '@app/module';
import { registerEngine } from '../../engines/engines-manager';
import { dbEngine } from '../../engines/db';
import { filigranTelemetryEngine } from '../../engines/filigran-telemetry';
import { httpServerEngine } from '../../engines/http-server';
import { createLogger } from '../../utils/logger';
import { beginEditionResolution } from '../edition';
import { servedProcedureManifest } from '../app-router/served-procedure-manifest';
import { registerFeature } from '../features-manager';
import { registerXtmSignInRoutes } from '../xtm-sign-in/xtm-sign-in-routes';
import { provideRegistrationRun, serializeRuns } from './xtm-one-check';
import { registerWithXtmOne } from './xtm-one-client';
import { getXtmOneSettings } from './xtm-one-config';
import { registerXtmOneRoutes } from './xtm-one-http';
import { resolveXtmOneIdentity } from './xtm-one-identity';
import { buildRegistrationHealth, REGISTRATION_INTERVAL_MS } from './xtm-one-registration';
import { xtmOneRootRouter } from './xtm-one-router';

const XTM_ONE_FEATURE_KEY = 'xtm-one';

const { logTrace } = createLogger({ feature: XTM_ONE_FEATURE_KEY });

const activateXtmOne = (): void => {
  // The status endpoint is always mounted so the frontend can gate the
  // "Ask Ariane" launcher on `configured` without extra error handling.
  httpServerEngine.registerRouter(({ protectedProcedure }) => xtmOneRootRouter(protectedProcedure));

  const settings = getXtmOneSettings();
  if (!settings) {
    logTrace('XTM One integration is disabled: no xtm_one block');
    return;
  }

  httpServerEngine.registerHttpRoutes((server) => {
    registerXtmOneRoutes(server, dbEngine.db);
    registerXtmSignInRoutes(server, dbEngine.db, settings, () => filigranTelemetryEngine.addUserLoginCount());
  });

  // This registration is what decides the platform edition, so the gates wait
  // for it rather than reading the fail-closed default while it is in flight.
  beginEditionResolution();

  // Registration/heartbeat lifecycle - runs once engines (DB) are started.
  registerEngine({
    key: XTM_ONE_FEATURE_KEY,
    start: () => {
      let heartbeatTimer: NodeJS.Timeout | undefined;

      // The platform's job health, every tenant's: a system read, reported to XTM One's Platform Health.
      // Built at each heartbeat, like the db the registration itself is handed: the engine's pool is
      // only open once the engines have started.
      const readHealth = async () => {
        const { jobs } = createServices([jobsService], dbEngine.db).withOrigin({ type: 'system' });
        return buildRegistrationHealth(await jobs.getPlatformJobHealths());
      };

      const runRegistration = serializeRuns(async () => {
        await registerWithXtmOne(settings, dbEngine.db, servedProcedureManifest, readHealth);
      });
      const register = () => {
        runRegistration().catch(() => {
          // registerWithXtmOne already logs; never crash the scheduler.
        });
      };

      return {
        onEnginesStarted: () => {
          logTrace('XTM One integration enabled', { url: settings.url });
          // Immediately, not on a delay: until it answers, an entitled
          // platform serves Community Edition and hides multi-tenancy.
          register();
          provideRegistrationRun(runRegistration);
          resolveXtmOneIdentity(settings).then((identity) => {
            if (identity !== settings.url) {
              logTrace('XTM One reached on an internal URL', { url: settings.url, identity });
            }
          }).catch(() => {
            // Never rejects: a failed read falls back to the configured URL.
          });
          heartbeatTimer = setInterval(register, REGISTRATION_INTERVAL_MS);
          heartbeatTimer.unref();
        },
        stop: () => {
          provideRegistrationRun(null);
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
          }
        },
      };
    },
  });
};

registerFeature({
  key: XTM_ONE_FEATURE_KEY,
  activate: activateXtmOne,
});
