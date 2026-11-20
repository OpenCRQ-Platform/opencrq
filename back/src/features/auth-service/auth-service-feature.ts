import { authService, createServices, notificationsService, tenantsService } from '@app/module';
import { getEdition, whenEditionResolved } from '../edition';
import { dbEngine } from '../../engines/db';
import { httpServerEngine } from '../../engines/http-server';
import { registerFeature } from '../features-manager';
import { getXtmOneSettings } from '../xtm-one/xtm-one-config';
import { wasXtmSignInReady } from '../xtm-sign-in/xtm-sign-in-client';
import { authServiceRouter } from './auth-service-router';

const activateAuthService = () => {
  httpServerEngine.registerRouter(({ publicProcedure, protectedProcedure }) => {
    const { db } = dbEngine;
    const services = createServices([authService, notificationsService, tenantsService], db);

    return authServiceRouter(
      { publicProcedure, protectedProcedure },
      services,
      async () => {
        await whenEditionResolved();
        return getEdition();
      },
      async () => {
        const settings = getXtmOneSettings();
        return settings !== null && await wasXtmSignInReady(settings.url);
      },
    );
  });
};

registerFeature({
  key: 'authService',
  activate: activateAuthService,
});
