---
applyTo: ".agents/**,.claude/skills/**,.claude/rules/**,scripts/render-agent-files.mjs"
description: 'The AI hub: what Claude Code and the pull request reviewer each read, why skills live under .claude and instructions are rendered'
---

<!-- Generated from .agents/instructions/agent-hub.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

# The AI hub

Claude Code is the development assistant and reads `.claude/`. Copilot only reviews pull requests
(`copilot-pull-request-reviewer`) and reads `AGENTS.md`, `CLAUDE.md` and `.github/instructions/`.
Where a file has to live follows from that. Skills and instructions get different answers.

## What each one loads, and when

| File | Claude Code | Pull request reviewer |
| --- | --- | --- |
| `AGENTS.md` | through the `@AGENTS.md` import in `CLAUDE.md` | natively |
| `CLAUDE.md` | always | natively |
| `.agents/instructions/*` | through `.claude/rules/*`, body loaded when a glob matches a file it **reads** | through `.github/instructions/*.instructions.md`, when a glob matches a file of the diff |
| `.claude/skills/*` | name and description, body on demand | never |

Claude Code has **no fallback onto `AGENTS.md`**: with no `CLAUDE.md` it loads no project memory at
all. `AGENTS.md` reaches it only through that import, which is why the import is the one line
`CLAUDE.md` cannot lose.

The reviewer follows no link (GitHub lists it as unsupported): what it has to know sits in a file
it reads natively, never behind a pointer.

So the split is: `AGENTS.md` carries what both need, `CLAUDE.md` what only Claude Code can act on.
The reviewer reads `CLAUDE.md` too, so nothing in it may contradict `AGENTS.md`.

**An `@` import ignores the scope of the file that carries it.** A `.claude/rules/*.md` body is
withheld until Claude works on a file its `paths` match, but an `@` line inside that rule is
expanded at session start whatever the globs say. Both halves are verified: a token written inside
a rule scoped to a glob nothing matches stays out of context, and the same token behind an `@`
import in the same rule is in context before the first message.

That is why a rule carries the instruction's body rather than an import of it. A stub of a few
lines looks cheaper and costs the opposite: every instruction in every session's context, and a
`paths` list that decides nothing.

**A rule's body arrives on the `Read` tool, and on nothing else.** Measured both ways on
2026-09-18: `Read` on a file injects every rule whose globs match it, while creating that same file
with `Write` injects none, and `cat`-ing it in a `Bash` call injects none either. A convention
therefore reaches an agent opening an existing file and never one creating the file the convention
governs, which is the whole of `create-domain-module`, `add-integration-test` and
`create-frontend-feature`. So: open a sibling file with `Read` before scaffolding a new one, and
reach for `Read` rather than `cat` on any source file, whatever a harness preamble recommends.

A worktree carries its own branch's `.claude/rules/`, `AGENTS.md` and `.claude/settings.json`. A
branch cut long ago serves conventions retired since, and one cut before these files existed serves
none and runs no hook at all. Nothing reconciles them: a rebase and CI catch stale code, never a
stale instruction. Rebase onto `origin/main` before trusting a convention in an old worktree.

## Skills live in `.claude/skills/`

It is the only skill directory Claude Code reads: `.agents/skills/` and `.github/skills/` are
**not** read by it, so moving the skills there for the symmetry would lose every one. No
repository-level setting buys it back: Claude Code's `skillsDirs` is team-store only. To
re-verify, write a throwaway skill in a candidate directory and watch the session: a discovered one
is announced within seconds. Delete it afterwards.

## Instructions: one source, two outputs

The reviewer finds path-scoped `*.instructions.md` only under `.github/instructions/` and expands
no import; Claude's rule files do expand `@`. One source therefore produces two outputs:

- `.agents/instructions/<name>.md` is the only file anyone edits;
- `yarn agent:build` renders the body into both `.github/instructions/<name>.instructions.md` and
  `.claude/rules/<name>.md`, each with the frontmatter its reader expects;
- `yarn agent:check` is what CI runs. It fails on a stale, missing or **orphaned** rendered file,
  and on the three defects a reader never notices: an `applyTo` glob matching no file in the
  repository (the instruction then loads nowhere), a link that resolves from only one of the three
  copies, and an instruction absent from the deep-dive list in `AGENTS.md`.

Never edit a rendered file: each carries a banner naming its source, and CI rejects the change.

The orphan case matters because a rule left behind when its source is gone keeps serving the body
it was rendered from, which is by then whatever the source said before it was deleted.

Frontmatter: `description` and `applyTo` are required, `assistants` narrows the render to one of
them and never reaches the model. A rendered file sits at a different depth from its source, so
name every path from the repository root: a depth-relative link breaks on the way out.
