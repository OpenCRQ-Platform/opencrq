type Node = {
  type: string,
  name?: string,
  property?: Node,
  object?: Node,
  callee?: Node,
  parent?: Node,
};

type RuleContext = {
  report: (descriptor: { node: Node, messageId: string, data?: Record<string, string> }) => void,
};

const GUARDED_METHOD_PREFIX = 'guarded';

const isInsideKeepingPlatformReachable = (node: Node): boolean => {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'CallExpression'
      && current.callee?.type === 'MemberExpression'
      && current.callee.property?.name === 'keepingPlatformReachable'
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

/**
 * Custom ESLint rule: flags a call to a repository method named `guarded*` — the platform
 * reachability invariant's guarded writes (`guardedDeletePlatformRole`,
 * `guardedRemoveUserFromPlatformGroup`, ...) — made outside `keepingPlatformReachable(...)`.
 *
 * These methods can empty `PlatformCapability_ManageUsers` or `PlatformCapability_PlatformAccess`,
 * locking the platform administration surface out for good.
 * `platformCapabilitiesService.keepingPlatformReachable` is what rolls the write back if it would.
 */
export const noUnguardedReachabilityWrite = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Disallow calling a repo.guarded* method outside keepingPlatformReachable().',
    },
    messages: {
      requiresGuard: '{{method}} can empty a platform reachability capability. Call it as '
        + 'deps.platformCapabilities.keepingPlatformReachable(() => repo.{{method}}(...)) instead.',
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: Node) {
        const callee = node.callee;
        const methodName = callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier'
          && callee.object.name === 'repo' && callee.property?.type === 'Identifier'
          ? callee.property.name
          : undefined;

        if (methodName?.startsWith(GUARDED_METHOD_PREFIX) && !isInsideKeepingPlatformReachable(node)) {
          context.report({ node, messageId: 'requiresGuard', data: { method: methodName } });
        }
      },
    };
  },
};
