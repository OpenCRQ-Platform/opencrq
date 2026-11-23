# Dependency rules

A dependency rule links supporting assets to a primary asset without a person making each link by hand. With synced inventories of thousands of assets, rules keep the primary assets linked, so the security needs and criticality they pass down through `support_to_primary` links stay complete.

## The rule

A rule is `conditions -> primary asset + roles`:

| Field | Meaning |
|---|---|
| `name` | Unique within the tenant. When several rules match one pair, the first by name wins. |
| `primaryAssetId` | The primary asset every matching supporting asset is linked to. |
| `roles` | The link roles written on each link (`stores`, `processes`, ...), as in "Manage dependencies". |
| `enabled` | A disabled rule holds no link. |
| `categoryId`, `subcategoryId` | The asset's category and subcategory. |
| `namePattern`, `namePatternKind` | A `glob` (`*` any run, `?` one character, anchored) or a `regex` (PostgreSQL POSIX). Both match case-insensitively against the asset's display name and every hostname a source reports. |
| `tagId` | A tag on the asset, a tag merged into it included. |
| `source` | The connector family that reports the asset (`openaev`, `microsoft_graph`, ...). |

A rule matches an asset when every condition it sets holds. It sets at least one.

## Preview

`assetDependencies.previewDependencyRule` answers what a rule would link if applied now: `total`, the first assets by display name, and the matches it leaves alone because a person linked (`alreadyManual`) or unlinked (`suppressed`) the pair. Preview and apply use the same matcher, so the preview is what the next apply writes.

## Precedence: a person always wins

- A link a person made is never rewritten or removed by a rule.
- A rule link a person edits (roles) or links again becomes theirs: the rule no longer touches it.
- A rule link a person removes is remembered (`dependency_rule_suppressions`): no rule links that pair again. Linking it by hand later is allowed.

## When rules apply

The `dependency-rules-apply` job is observed: it runs when what it reads changes, so after each sync that changes the inventory (names, hostnames, categories, tags, sources) and after every rule change. It inserts the missing rule links, rewrites those whose roles or winning rule changed, and removes those whose asset no longer matches. Deleting a rule deletes its links; disabling it removes them at the next apply.

## API

Every support-to-primary link read (`getSupportToPrimaryLinksBySupportingAssetId`, `getSupportToPrimaryLinksByPrimaryAssetId`) carries:

- `source`: `manual` or `rule`
- `ruleId` and `ruleName`: the rule that wrote it, null for a manual link

Rules are managed with `listDependencyRules`, `previewDependencyRule`, `createDependencyRule`, `updateDependencyRule` and `deleteDependencyRules` on the `assetDependencies` router.
