import type { Linter } from 'eslint';

/** Flags direct db.transaction/execute, rawDb(), and new Date() in SET clauses of secured repository files */
export const repositorySecurityRules: Linter.RulesRecord = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'MemberExpression[object.name="db"][property.name="transaction"]',
      message: 'Direct db.transaction() bypasses the service atomic() pattern. Use atomic() in the service layer or rawDb().transaction() with justification.',
    },
    {
      selector: 'MemberExpression[object.name="db"][property.name="execute"]',
      message: 'Direct db.execute() bypasses security. Use rawDb().execute() with justification.',
    },
    {
      selector: 'CallExpression[callee.name="rawDb"]',
      message: 'rawDb() bypasses security (ProtectedDB). Justify with: // eslint-disable-next-line no-restricted-syntax -- <reason>',
    },
    {
      selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
      message: 'Use sql`now()` instead of new Date() to avoid clock skew between the Node.js process and PostgreSQL.',
    },
  ],
};
