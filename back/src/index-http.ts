import { boot } from './boot/boot';

import './features/app-router/app-router-feature';
import './features/auth-service/auth-service-feature';
import './features/edition/edition-feature';
import './features/edition/edition-status-feature';
import './features/xtm-one/xtm-one-feature';
import './features/events';
import './features/filigran-telemetry';
import './features/web-app/web-app-feature';
import './features/file-storage';
import './features/maps';
import './features/threat-uploader';
import './features/xtm-peer-tokens';

boot();
