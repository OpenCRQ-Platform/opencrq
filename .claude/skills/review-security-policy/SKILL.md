---
name: review-security-policy
description: >-
  Reviews security policies for domain modules. Checks that every table has
  the correct policy, FK cascades follow conventions, and tenant isolation
  is tested. Use when reviewing security, permissions, or data isolation.
---

# Review Security Policy

## When to Use

- After creating or modifying a domain module schema
- When reviewing a PR that touches security policies, FK references, or multi-tenant data access
- When investigating data leaks or tenant isolation issues

## Procedure

### Step 1 — Verify every table has a security policy

For each table in the module's `schema.ts`:

| Table type | Expected policy | How to verify |
|---|---|---|
| Direct `tenantId` column | `tenantIsolationPolicy` | `defineSecurityPolicies(table, tenantIsolationPolicy)` |
| `organizationId` column | `organizationTenantIsolationPolicy` | Joins through `organizations.tenant_id` |
| Own `tenantId` beside an FK to a tenant-scoped parent | `tenantIsolationPolicy` | The FK is composite, `(parent_id, tenant_id)` → the parent's `UNIQUE (id, tenant_id)`, or a row can name another tenant's parent |
| FK to tenant-scoped parent | A `parentScopedPolicy` (e.g. `attackOutcomeTenantIsolationPolicy`) | Joins through parent table |
| FK chain (parent → org → tenant) | A `parentScopedPolicy` (e.g. `primaryAssetTenantIsolationPolicy`) | Joins through multiple tables |
| Junction table | Same policy as the "owning" side | Must be defined |
| Global reference data (no tenant) | **No policy** | Repository uses `db` directly, not `views` |

**Red flags:**
- ❌ Table with `tenantId` but no `defineSecurityPolicies()` call
- ❌ Junction table without a security policy
- ❌ Repository reading from `db.select().from(table)` instead of `views.table` (for tenant-scoped tables)

### Step 2 — Verify FK cascade conventions

Check all `references()` calls in the schema:

| FK type | Expected `onDelete` |
|---|---|
| Junction table FK (both sides) | `'cascade'` ✅ |
| Entity-to-entity FK (e.g. `org → tenant`) | **No cascade** (default `'no action'`) ✅ |

**Red flags:**
- ❌ Junction table FK without `onDelete: 'cascade'`
- ❌ Entity-to-entity FK with `onDelete: 'cascade'` (could silently wipe data)

### Step 3 — Verify repository read/write patterns

In the module's `repository.ts`:

| Operation | Must use |
|---|---|
| Read (select, findById, findAll) | `views.*` (security-filtered) |
| Write (insert) | `db.insert(rawTable).values(...)` |
| Update | `db.update(rawTable).set(...).where(...)` |
| Delete | `db.delete(rawTable).where(...)` |

**Red flags:**
- ❌ Reading from raw table instead of `views` (bypasses tenant isolation)
- ❌ Writing to `views` instead of raw table
- ❌ Direct `db.insert()` / `db.update()` / `db.delete()` on tenant-scoped tables

### Step 4 — Verify integration tests exist

Check `integration-tests/src/tests/service/<domain>.test.ts`:

| Required test | What it verifies |
|---|---|
| CRUD (create/read/update/delete) | Basic operations work |
| Security policy (unauthorized user) | Users without capability can't access data |
| Tenant isolation (cross-tenant list) | User A can't list Tenant B's data |
| Tenant isolation (cross-tenant get by ID) | User A can't get Tenant B's entity by ID |
| Tenant isolation (cross-tenant update) | User A can't modify Tenant B's entity |
| Tenant isolation (cross-tenant delete) | User A can't delete Tenant B's entity |
| Cascade delete (junction tables) | Deleting parent removes junction rows |

**Red flags:**
- ❌ No integration test file at all
- ❌ Missing tenant isolation tests
- ❌ Tests that don't call `truncateAllTables()` in `beforeEach`

### Step 5 — Verify custom policy implementation (if applicable)

In `module/src/security/policies/tenant-policies.ts`:

- The policy must implement all four operations: `read`, `create`, `update`, `delete`
- Each operation must return an `exists(...)` subquery that joins back to `tenant_users`
- The join chain must correctly traverse FKs to reach `tenant_users.tenantId`

### Step 6 — Report findings

Summarize:
1. **Tables without policies** (critical)
2. **Wrong FK cascades** (high)
3. **Repository bypassing views** (critical)
4. **Missing integration tests** (medium)
5. **Recommendations** for fixes

## Quick Checklist

```
[ ] Every tenant-scoped table has defineSecurityPolicies()
[ ] Junction table FKs have onDelete: 'cascade'
[ ] Entity-to-entity FKs do NOT cascade
[ ] Repository reads use views.*, writes use db.insert/update/delete (policy-enforced)
[ ] Integration tests cover CRUD + security + tenant isolation
[ ] Custom policies join correctly back to tenant_users
[ ] No direct db.insert/update/delete on tenant-scoped tables
```
