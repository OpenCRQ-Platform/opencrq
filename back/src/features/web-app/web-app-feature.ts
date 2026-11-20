import path from 'node:path';
import { config } from '../../config';
import { httpServerEngine } from '../../engines/http-server';
import { registerFeature } from '../features-manager';

const WEB_APP_FEATURE_KEY = 'web-app';

registerFeature({
  key: WEB_APP_FEATURE_KEY,
  activate: () => {
    const defaultDevPath = path.resolve(process.cwd(), '../front/dist');
    const root = config().front_path || defaultDevPath;
    httpServerEngine.registerSPA({ root });
  },
});
