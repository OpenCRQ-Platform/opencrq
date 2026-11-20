---
paths:
  - "module/src/modules/**"
  - "back/src/features/**"
---

<!-- Generated from .agents/instructions/integration-tests.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

When a change needs an integration test. The conventions below apply to the file being read.

# Integration Tests

## When to Write Integration Tests

Write integration tests when changes involve any of the following:

- **New domain module** — every new module needs service-level tests for CRUD, security policies, and tenant isolation.
- **New or modified security policy** — verify that the policy correctly allows/denies access (test both the happy path and unauthorized access).
- **New or modified service method** — test the method against a real database to catch SQL/query issues that unit tests miss.
- **New or modified tRPC endpoint** — add an HTTP-level test when the endpoint has auth, input validation, or cookie handling logic.
- **Cascade delete or FK changes** — verify that deleting a parent entity correctly cascades (or doesn't) to related rows.
- **Cross-entity validation** — when a service validates that referenced entities exist and belong to the same tenant.
- **Multi-tenant data isolation** — when the change could affect which tenants see which data, add isolation tests.

Do **not** write integration tests for pure utility functions, frontend components, or changes that are already covered by existing tests.

Writing one is covered by the `writing-integration-tests` conventions, which load on the test files themselves.
