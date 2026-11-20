import { httpServerEngine } from '../../engines/http-server';
import { createServedProcedureManifest } from './procedure-manifest';

/** The manifest of what this process's `/trpc` serves, shared by the query and the XTM One registration. */
export const servedProcedureManifest = createServedProcedureManifest(() => httpServerEngine.getServedRouter());
