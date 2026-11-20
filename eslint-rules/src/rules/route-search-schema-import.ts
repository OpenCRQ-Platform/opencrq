type NoRestrictedSyntaxEntry = { selector: string, message: string };

/**
 * Spread into a workspace's `no-restricted-syntax` array (never into a rules object), scoped to
 * route files. A barrel under `features` sits in an import cycle with the generated route tree: a
 * search-params schema or its defaults dereferenced at module evaluation (`validateSearch: fooSchema`,
 * `stripSearchParams(FOO_DEFAULTS)`) can throw a temporal-dead-zone `ReferenceError` the moment the
 * app boots, producing a blank screen no type-check or test catches. Only the schema's own
 * `-list-search` module is a safe source, which is what the path pattern lets through.
 *
 * The imported names are the other half of the net: `*SearchSchema` and `*_SEARCH_DEFAULTS` are
 * the export names the frontend convention requires, and nothing else can be told apart from the
 * components a route legitimately imports from the same barrel.
 */
export const routeSearchSchemaImportSelectors: Array<NoRestrictedSyntaxEntry> = [
  {
    selector: 'ImportDeclaration[source.value=/(^|\\/)features(\\/(?!.*-list-search$).*)?$/] > ImportSpecifier[imported.name=/(SearchSchema|_SEARCH_DEFAULTS)$/]',
    message: 'Import this search schema (or its defaults) directly from its own `-list-search` module, not from a barrel — a barrel under `features` is in an import cycle with the route tree and can throw a temporal-dead-zone ReferenceError at boot. Import the component from the barrel as usual, and the schema/defaults from their own file (e.g. features/<feature>/<name>-list-search).',
  },
];
