---
applyTo: "front/src/**/*.ts,front/src/**/*.tsx"
description: 'Toast notifications: when to raise one, which variant, and the wording rules'
---

<!-- Generated from .agents/instructions/toaster.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

# Toast Notification Rules

## Philosophy

A toast must be shown **only when the user cannot directly see that their action had an effect**. If the UI already provides visual feedback (animation, navigation, inline state change), the toast is redundant and should be skipped.

## When to show a toast

| Action type | Toast? | Reason |
|---|---|---|
| **Create** | Yes | The created item appears in a list the user may not be looking at |
| **Edit** (drawer/sheet closes) | Yes | The change is not immediately visible after the drawer closes |
| **Delete** | Yes | The row disappears, but explicit confirmation is helpful |
| **Settings update** | Yes | Form stays on the same page, feedback confirms persistence |

## When NOT to show a toast (`skipSuccessToast: true`)

| Action type | Reason |
|---|---|
| **Auth flows** (login, logout, register) | Immediate redirect or page reload |
| **Locale/theme change** | Visual change is instant |
| **Notification mark as read/unread** | Badge/counter updates inline |
| **Auto-save** (e.g. TEF input) | Saves silently in the background |
| **Actions with visual animation** (e.g. CRQ simulation) | Polling/progress indicator provides feedback |
| **Batch sub-mutations** | Skip individual toasts, show a single manual toast after `Promise.all` |
| **Add members** | The drawer shows who was added, and who was not |

## Batch mutation pattern

When a form triggers multiple mutations (e.g. update group + add/remove roles + add/remove users):

```ts
// Each sub-mutation: skipSuccessToast
const trpc = useTRPC();
const updateMutation = useMutation(trpc.groups.updateGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
const addRoleMutation = useMutation(trpc.groups.addRoleToGroup.mutationOptions({ meta: { skipSuccessToast: true } }));

// Single toast after all complete
await Promise.all([...]);
toast({ description: t`Group updated successfully.` });
```

## Duration

Toast duration is set globally to **2 000 ms** in `trpc-provider.tsx` via `duration: 2000` on each `toast()` call. Do not override unless a specific toast needs to stay longer (e.g. the health-check disconnected toast uses `Infinity`).

## Implementation details

- The global success/error toasts are handled in `src/providers/trpc-provider.tsx` via `MutationCache` and `QueryCache`.
- Use `meta: { skipSuccessToast: true }` on the `mutationOptions()` options to suppress the automatic success toast.
- Use `meta: { skipErrorToast: true }` to suppress the automatic error toast (rare — only when custom error handling is needed).
- Use `meta: { successMessage: msg`...` }` to customize the success message (uses Lingui `MessageDescriptor`).
- Success toast messages use **sentence case with a period** at the end (e.g. `'Tenant created successfully.'`).
