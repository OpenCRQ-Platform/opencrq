import { newError } from '@app/utils';

interface EngineHandler {
  onEnginesStarted?: () => void | Promise<void>,
  onEnginesStopping?: () => void | Promise<void>,
  stop?: () => void | Promise<void>,
  /** Stopped once every other engine has: what the others still use while they stop. */
  stopsLast?: boolean,
}

export interface Engine {
  key: string,
  start: (signal: AbortSignal) => EngineHandler | Promise<EngineHandler>,
}

type RegistrationVerb = (...args: Array<never>) => unknown;

type BootWindow = 'open' | 'sealed';
let bootWindow: BootWindow = 'open';

const registry: Record<string, Engine> = {};

const guardRegistrationApi = <RegApi extends object>(registrationApi: RegApi): RegApi => {
  const guarded: Record<string, RegistrationVerb> = {};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Object.entries loses value types; RegistrationVerb is the correct shape by construction
  for (const [name, verb] of Object.entries(registrationApi) as Array<[string, RegistrationVerb]>) {
    guarded[name] = (...args: Array<never>) => {
      if (bootWindow === 'sealed') {
        throw newError('Registration is sealed: must be called during feature activation or an engine start(), not after engines have started', { what: name });
      }
      return verb(...args);
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Record<string, RegistrationVerb> is structurally identical to RegApi by construction
  return guarded as unknown as RegApi;
};

export const registerEngine = <Api extends object = object, RegApi extends object = object>(
  { key, start, api, registrationApi }: Engine & { api?: Api, registrationApi?: RegApi },
): (Api & RegApi) => {
  if (registry[key]) {
    throw newError('Engine is already registered', { key });
  }
  registry[key] = { key, start };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- spread of api+registrationApi produces Api & RegApi by construction
  return {
    ...api,
    ...(registrationApi && guardRegistrationApi(registrationApi)),
  } as Api & RegApi;
};

export const listEngines = (): Array<Engine> => Object.values(registry);

export const sealEngineRegistration = (): void => {
  bootWindow = 'sealed';
};
