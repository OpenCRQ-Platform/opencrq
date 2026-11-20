---
paths:
  - ".agents/hooks/**"
  - ".claude/settings.json"
---

<!-- Generated from .agents/instructions/hooks.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

Claude Code hooks: the decision core, the adapter, and how to add a guard. The conventions below apply to the file being read.

# Claude Code hooks

Hooks let Claude Code refuse a tool call before it runs. The decision is written in `guards.mjs`, and `claude.mjs` only parses the payload and phrases the refusal.

```
.agents/hooks/
├── guards.mjs             # the decisions: what a read or a write is allowed to do
└── claude.mjs             # adapter: Claude payload in, Claude refusal out

.claude/settings.json      # wiring: PreToolUse matchers -> claude.mjs
```

Everything is Node, so one implementation serves bash and PowerShell alike. There is no `.sh` / `.ps1` pair to keep in step.

## What is guarded

**Reads.** A whole-file read above 120 KB is refused: it lands tens of thousands of tokens in context at once (a Drizzle snapshot is ~140 KB, a vendored dataset 1.5 MB). A read bounded by an offset or a limit passes, and so does an image or a PDF, whose size says nothing about what it costs.

**Shell reads of the same files.** `cat`, `bat`, `type` and `Get-Content` are held to that limit too, or the guard would only protect the tool an agent in bypass mode is told not to use. A pipe into a bounding filter (`head`, `grep`, `sed`, `jq`, ...) passes, since only what it lets through reaches the context. It is a guard against the accident, not against a determined `sed -n '1,$p'`.

**Writes to generated files.** `routeTree.gen.ts`, the compiled `locales/*/messages.ts`, `back/trpc-procedures.json`, the XTM One contract pin in `back/src/features/xtm-one/contract/`, and any `db/migrations/*.sql` already on `origin/main`. A migration is only half generated: the schema conventions have the `notify_data_changed` triggers hand-appended to the file `yarn db:generate` produced, and reconciling a branch down to a single migration rewrites its SQL, so the branch's own migration stays writable. One already on `origin/main` has been applied everywhere it reached and is refused. The guard shells out to git for that answer, and an unreachable git allows the write.

There is deliberately **no `postToolUse` hook**. Linting and type-checking after every edit cost a full workspace type-check per tool call for a result that cannot block anything. The `/lint`, `/check-ts` and `/test` skills do the same work when it is actually wanted.

## Adding a guard

1. Add the decision to `guards.mjs`, as a function returning `null` to allow or the sentence Claude should be told.
2. Call it from `claude.mjs`, which already knows how to read a path and how to phrase a refusal.
3. Add a case to its checks if the tool family is new.

Keep a `PreToolUse` guard under 5 seconds: it blocks the tool while it runs.

## Payload

Claude Code selects the tool with a `matcher` in `.claude/settings.json`, and sends:

```json
{ "tool_name": "Read", "tool_input": { "file_path": "src/file.ts", "limit": 40 } }
```

It refuses with:

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..." } }
```

## Testing a hook

Pipe a payload in and read what comes out. No output means the call is allowed.

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"front/src/routeTree.gen.ts"}}' | node .agents/hooks/claude.mjs Edit
```
