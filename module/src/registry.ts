import { newError } from '@app/utils';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { DrizzleDB, ProtectedDB, ProtectedTransaction, Transaction } from './db';
import type { EventOrigin, SecuredSchema } from './security';
import { createProtectedDB, createSecuredSchema } from './security';

export type { EventOrigin };

/*
 * The service registry uses `any` deliberately in several positions:
 *  - Index signatures and conditional-type `extends` checks require `any` to
 *    match arbitrary function signatures regardless of context type (using
 *    `unknown` would fail because RepositoryContext is not assignable to unknown
 *    in the contravariant position of an `extends` check).
 *  - Internal implementation variables (`wrapWithTracing`, `publicServices`,
 *    `createRepositoryProxy`) use `any` for type erasure in the generic runtime
 *    engine that cannot be expressed with typed alternatives without significant
 *    loss of type-safety elsewhere.
 * All public APIs exposed by this file are fully typed; `any` is contained here.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */

export type RepositoryContext = {
  db: ProtectedDB | ProtectedTransaction,
  views: SecuredSchema,
  rawDb: () => DrizzleDB | Transaction,
};

/** Context for the auth repository — no security layer (requires raw DB for sessions/transactions) */
export type GlobalRepositoryContext = {
  db: DrizzleDB | Transaction,
};

export type RepositoryImplementation = {
  [key: string]: (ctx: RepositoryContext, ...args: Array<any>) => any,
};

export type GlobalRepositoryImplementation = {
  [key: string]: (ctx: GlobalRepositoryContext, ...args: Array<any>) => any,
};

/** Base constraint satisfied by both RepositoryImplementation and GlobalRepositoryImplementation */
export type AnyRepositoryImplementation = {
  [key: string]: (ctx: any, ...args: Array<any>) => any,
};

export type InferRepository<T extends AnyRepositoryImplementation> = {
  [K in keyof T]: T[K] extends (ctx: any, ...args: infer Args) => infer R
    ? (...args: Args) => R
    : T[K];
};

export interface ServiceContext<TRepo, TDeps> {
  readonly repo: TRepo,
  readonly deps: TDeps,
  readonly eventOrigin: EventOrigin,
  /** Wraps logic in a transaction. Re-binds dependencies to the new transaction. */
  readonly atomic: <T>(
    callback: (ctx: Omit<ServiceContext<TRepo, TDeps>, 'atomic'>) => Promise<T>,
  ) => Promise<T>,
}

type RawMethod<TRepo, TDeps, Args extends Array<any>, Result> =
  (context: ServiceContext<TRepo, TDeps>, ...args: Args) => Promise<Result>;
type RawImpl<TRepo, TDeps> = { [key: string]: RawMethod<TRepo, TDeps, Array<any>, any> };
type PublicMethod<F> = F extends (ctx: any, ...args: infer Args) => infer R ? (...args: Args) => R : never;
type PublicService<Impl> = { [K in keyof Impl]: PublicMethod<Impl[K]> };
/**
 * The caller-facing shape of a service definition: its methods without the context argument the
 * registry injects. It is what a `dependsOn` entry resolves to, and what a helper shared between
 * two methods of one service must name to accept the dependencies it was handed.
 */
export type ExtractPublicFromDef<T> = T extends ServiceDefinition<any, any, infer I> ? PublicService<I> : never;

type ExtractDepsFromFactory<F extends () => ReadonlyArray<ServiceDefinition<any, any, any>>> = {
  [D in ReturnType<F>[number] as D['name']]: ExtractPublicFromDef<D>
};

export interface ServiceDefinition<Name extends string, TRepoImpl extends AnyRepositoryImplementation, Impl> {
  name: Name,
  repositoryImplementation: TRepoImpl,
  methods: Impl,
  dependenciesFactory: () => ReadonlyArray<ServiceDefinition<any, any, any>>,
}

interface ServiceImplementation<Name extends string, TRepoImpl extends AnyRepositoryImplementation, TDeps> {
  implement: <Impl extends RawImpl<InferRepository<TRepoImpl>, TDeps>>(
    methods: Impl,
  ) => ServiceDefinition<Name, TRepoImpl, Impl>,
}

interface ServiceBuilder<Name extends string, TRepoImpl extends AnyRepositoryImplementation, TDeps>
  extends ServiceImplementation<Name, TRepoImpl, TDeps> {
  dependsOn: <DepsFactory extends () => ReadonlyArray<ServiceDefinition<any, any, any>>>(
    depsFactory: DepsFactory,
  ) => ServiceImplementation<Name, TRepoImpl, ExtractDepsFromFactory<DepsFactory>>,
}

const tracer = trace.getTracer('@app/module');

const wrapWithTracing = (methods: any, kind: 'service' | 'repository', prefix?: string) => {
  const wrapped: any = {};
  for (const key in methods) {
    const method = methods[key];
    if (typeof method === 'function') {
      const spanName = `${kind}.${prefix ? `${prefix}.${key}` : key}`;
      wrapped[key] = async (context: any, ...args: Array<any>) => tracer
        .startActiveSpan(spanName, async (span) => {
          try {
            return await method(context, ...args);
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        });
    } else {
      wrapped[key] = method;
    }
  }
  return wrapped;
};

export const defineRepository = <T extends RepositoryImplementation>(implementation: T) => wrapWithTracing(implementation, 'repository') as T;

const GLOBAL_REPO_MARKER = Symbol('globalRepository');

export const isGlobalRepository = (repo: AnyRepositoryImplementation): boolean =>
  (repo as any)[GLOBAL_REPO_MARKER] === true;

export const defineGlobalRepository = <T extends GlobalRepositoryImplementation>(implementation: T) => {
  const wrapped = wrapWithTracing(implementation, 'repository') as T;
  (wrapped as any)[GLOBAL_REPO_MARKER] = true;
  return wrapped;
};

export const defineService = <Name extends string, TRepoImpl extends AnyRepositoryImplementation>(
  name: Name,
  repositoryImplementation: TRepoImpl,
): ServiceBuilder<Name, TRepoImpl, {}> => {
  const createImplementation = (depsFactory: () => ReadonlyArray<ServiceDefinition<any, any, any>>) => ({
    implement: (methods: any) => {
      const wrappedMethods = wrapWithTracing(methods, 'service', name);
      return { name, repositoryImplementation, methods: wrappedMethods, dependenciesFactory: depsFactory };
    },
  });

  return {
    dependsOn: (depsFactory) => createImplementation(depsFactory),
    implement: createImplementation(() => []).implement,
  };
};

// ==================================================================================
// Runtime Engine
// ==================================================================================
type ExtractService<D> = D extends ServiceDefinition<infer N, any, infer I> ? { [K in N]: PublicService<I> } : never;
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

export const createServices = <ServiceDefinitions extends ReadonlyArray<ServiceDefinition<any, any, any>>>(
  entryServiceDefinitions: [...ServiceDefinitions],
  db: DrizzleDB | Transaction,
) => {
  type Services = UnionToIntersection<ExtractService<ServiceDefinitions[number]>>;

  type BoundApp = {
    repositoryContext: RepositoryContext,
    services: Services,
  };

  type BoundAppResolver = (tx: DrizzleDB | Transaction) => BoundApp;

  const publicServices: any = {};
  const registry = new Map<string, ServiceDefinition<any, any, any>>();

  const registerDefinitionRecursive = (def: ServiceDefinition<any, any, any>) => {
    if (registry.has(def.name)) {
      return;
    }
    registry.set(def.name, def);
    publicServices[def.name] = {};

    const resolvedDeps = def.dependenciesFactory();
    for (const dep of resolvedDeps) {
      if (!dep) {
        throw new Error(`Circular Dependency or Import Error in service "${def.name}"`);
      }
      registerDefinitionRecursive(dep);
    }
  };
  entryServiceDefinitions.forEach(registerDefinitionRecursive);

  const ensureTransaction = <T>(
    currentDb: DrizzleDB | Transaction,
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> => {
    const runner = currentDb === db && !(db instanceof PgTransaction)
      ? (cb: any) => db.transaction(cb)
      : (cb: any) => cb(currentDb);
    return runner(async (tx: Transaction) => await callback(tx));
  };

  /**
   * Every `atomic` gets a scope of its own: a transaction at the top, a savepoint when one is
   * already open. Reusing the open transaction instead would make a caught inner failure poison the
   * whole outer one, so a loop meaning to skip one bad item would lose every other.
   */
  const runAtomic = <T>(
    currentDb: DrizzleDB | Transaction,
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> => (currentDb as DrizzleDB).transaction(async (tx: Transaction) => await callback(tx));

  const createRepositoryContext = (
    currentDb: DrizzleDB | Transaction,
    eventOrigin: EventOrigin,
  ): RepositoryContext => ({
    db: createProtectedDB(currentDb, (callback) => ensureTransaction(currentDb, callback), eventOrigin),
    views: createSecuredSchema(currentDb, eventOrigin),
    rawDb: () => currentDb,
  });

  const createRepositoryProxy = <T extends AnyRepositoryImplementation>(
    implementation: T,
    ctx: RepositoryContext,
  ): InferRepository<T> => new Proxy(implementation, {
    get: (target, prop) => {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return (...args: Array<any>) => value(ctx, ...args);
      }
      return value;
    },
  }) as InferRepository<T>;

  const createContext = <TRepo, TDeps>(
    repoFactory: (repositoryContext: RepositoryContext) => TRepo,
    eventOrigin: EventOrigin,
    currentDb: DrizzleDB | Transaction,
    boundApp: BoundApp,
    resolveBoundApp: BoundAppResolver,
  ): ServiceContext<TRepo, TDeps> => ({
    repo: repoFactory(boundApp.repositoryContext),
    deps: boundApp.services as TDeps,
    eventOrigin,
    atomic: (callback) => runAtomic(currentDb, async (newTx) => {
      const newBoundApp = resolveBoundApp(newTx);
      return callback({
        repo: repoFactory(newBoundApp.repositoryContext),
        deps: newBoundApp.services as TDeps,
        eventOrigin,
      });
    }),
  });

  const createBoundAppFactory = (eventOrigin: EventOrigin) => {
    const boundAppCache = new WeakMap<DrizzleDB | Transaction, BoundApp>();

    const resolveBoundApp: BoundAppResolver = (dbOrTx: DrizzleDB | Transaction) => {
      if (boundAppCache.has(dbOrTx)) {
        return boundAppCache.get(dbOrTx)!;
      }

      const repositoryContext = createRepositoryContext(dbOrTx, eventOrigin);
      const serviceProxyCache = new Map<string, any>();

      const servicesProxy = new Proxy(publicServices, {
        get: (target, serviceNameKey) => {
          const serviceName = String(serviceNameKey);

          if (serviceProxyCache.has(serviceName)) {
            return serviceProxyCache.get(serviceName);
          }

          if (!registry.has(serviceName)) {
            throw newError('Unable to find service', { serviceName });
          }

          const serviceDefinition = registry.get(serviceName)!;
          const isGlobal = isGlobalRepository(serviceDefinition.repositoryImplementation);

          const boundRepositoryFactory = (rCtx: RepositoryContext) =>
            createRepositoryProxy(
              serviceDefinition.repositoryImplementation,
              isGlobal ? { db: rCtx.rawDb() } as any : rCtx,
            );

          const methodCache = new Map<string, any>();

          const serviceProxy = new Proxy(target[serviceName], {
            get: (_, methodKey) => {
              const methodName = String(methodKey);

              if (methodCache.has(methodName)) {
                return methodCache.get(methodName);
              }

              const serviceMethod = serviceDefinition.methods[methodName];
              if (!serviceMethod) {
                throw newError('Unable to find method', { methodName });
              }

              const boundMethod = (...args: Array<any>) => serviceMethod(
                createContext(
                  boundRepositoryFactory,
                  eventOrigin,
                  dbOrTx,
                  boundApp,
                  resolveBoundApp,
                ),
                ...args,
              );

              methodCache.set(methodName, boundMethod);
              return boundMethod;
            },
          });

          serviceProxyCache.set(serviceName, serviceProxy);
          return serviceProxy;
        },
      });

      const boundApp: BoundApp = {
        repositoryContext,
        services: servicesProxy as Services,
      };

      boundAppCache.set(dbOrTx, boundApp);
      return boundApp;
    };

    return resolveBoundApp;
  };

  return {
    withOrigin: (origin: EventOrigin): Services => createBoundAppFactory(origin)(db).services,
  };
};

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */
