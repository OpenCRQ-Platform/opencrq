import type { ESLint } from 'eslint';
import { noDistinctOnSubquery } from './no-distinct-on-subquery';
import { noFullRowListOutput } from './no-full-row-list-output';
import { noImplicitIndexNullsOrder } from './no-implicit-index-nulls-order';
import { noOptionalQueryOutput } from './no-optional-query-output';
import { noPlainErrorClass } from './no-plain-error-class';
import { noRawError } from './no-raw-error';
import { noRawTableInReads } from './no-raw-table-in-reads';
import { noUnboundedListQuery } from './no-unbounded-list-query';
import { noUnguardedReachabilityWrite } from './no-unguarded-reachability-write';
import { noUnguardedRewrite } from './no-unguarded-rewrite';
import { noUnusedRepoMethod, noUnusedRouterEndpoint, noUnusedServiceMethod } from './no-unused-endpoint';

export { historyTables } from './history-tables';

type PluginRule = ESLint.Plugin['rules'] extends Record<string, infer R> ? R : never;

export const appPlugin: ESLint.Plugin = {
  meta: { name: 'eslint-plugin-app', version: '1.0.0' },
  rules: {
    // Cast needed: custom lightweight Node/RuleContext types in the rule are incompatible with ESLint's generic types
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- custom RuleContext<> generics are not assignable to ESLint's broader Plugin types
    'no-raw-table-in-reads': noRawTableInReads as PluginRule,
    'no-unused-repo-method': noUnusedRepoMethod,
    'no-unused-service-method': noUnusedServiceMethod,
    'no-unused-router-endpoint': noUnusedRouterEndpoint,
    'no-optional-query-output': noOptionalQueryOutput,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- custom RuleContext<> generics are not assignable to ESLint's broader Plugin types
    'no-unbounded-list-query': noUnboundedListQuery as PluginRule,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- custom RuleContext<> generics are not assignable to ESLint's broader Plugin types
    'no-distinct-on-subquery': noDistinctOnSubquery as PluginRule,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- custom RuleContext<> generics are not assignable to ESLint's broader Plugin types
    'no-implicit-index-nulls-order': noImplicitIndexNullsOrder as PluginRule,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- custom RuleContext<> generics are not assignable to ESLint's broader Plugin types
    'no-full-row-list-output': noFullRowListOutput as PluginRule,
    'no-raw-error': noRawError,
    'no-plain-error-class': noPlainErrorClass,
    'no-unguarded-reachability-write': noUnguardedReachabilityWrite,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- custom RuleContext<> generics are not assignable to ESLint's broader Plugin types
    'no-unguarded-rewrite': noUnguardedRewrite as PluginRule,
  },
};
