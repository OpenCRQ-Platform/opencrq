import type { TSESTree } from '@typescript-eslint/utils';

type Variable = {
  defs: Array<{ node: TSESTree.Node }>,
  references: Array<{ identifier: TSESTree.Node }>,
};

type Scope = {
  set: Map<string, Variable>,
  upper: Scope | null,
};

export type ScopeContext = {
  sourceCode: {
    getScope: (node: TSESTree.Node) => Scope,
    getDeclaredVariables: (node: TSESTree.Node) => ReadonlyArray<Variable>,
  },
};

const variableNamed = (from: Scope, name: string): Variable | undefined => {
  for (let scope: Scope | null = from; scope !== null; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable !== undefined) {
      return variable;
    }
  }
  return undefined;
};

const constInitializer = (variable: Variable): TSESTree.Node | undefined => {
  const declarator = variable.defs[0]?.node;
  return declarator?.type === 'VariableDeclarator' && declarator.parent.kind === 'const' ? declarator.init ?? undefined : undefined;
};

/**
 * What an identifier holds when it names a `const`, followed through `const` aliases, or the node
 * itself: a rule reading an expression must not be escaped by moving it into a constant. A binding
 * already followed ends the walk, so a cycle stops while a shadowing constant of the same name does not.
 */
export const initializerOf = (context: ScopeContext, node: TSESTree.Node): TSESTree.Node => {
  const seen = new Set<Variable>();
  let at = node;
  while (at.type === 'Identifier') {
    const variable = variableNamed(context.sourceCode.getScope(at), at.name);
    const init = variable === undefined || seen.has(variable) ? undefined : constInitializer(variable);
    if (variable === undefined || init === undefined) {
      break;
    }
    seen.add(variable);
    at = init;
  }
  return at;
};

const STOPS = new Set<string>(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'Program']);

/**
 * Where the expression holding `node` is read, the other way round: `node` itself and, where it sits
 * in the initializer of a `const`, every identifier reading that constant, followed through the
 * constants built on it.
 */
export const usesOf = (context: ScopeContext, node: TSESTree.Node): Array<TSESTree.Node> => {
  const uses: Array<TSESTree.Node> = [];
  const seen = new Set<TSESTree.Node>();
  const visit = (at: TSESTree.Node) => {
    uses.push(at);
    let declarator: TSESTree.Node | undefined = at.parent;
    while (declarator !== undefined && declarator.type !== 'VariableDeclarator' && !STOPS.has(declarator.type) && !declarator.type.endsWith('Statement')) {
      declarator = declarator.parent;
    }
    if (declarator?.type !== 'VariableDeclarator' || declarator.parent.kind !== 'const' || seen.has(declarator)) {
      return;
    }
    seen.add(declarator);
    for (const variable of context.sourceCode.getDeclaredVariables(declarator)) {
      for (const reference of variable.references) {
        visit(reference.identifier);
      }
    }
  };
  visit(node);
  return uses;
};
