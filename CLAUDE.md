# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The full project context (architecture, conventions, security rules, deep-dive references and
skills) lives in the file imported below, the single source of truth. The pull request reviewer
(Copilot) reads it on its own.

@AGENTS.md

## Claude Code tooling (this repo)

- `/lint`, `/check-ts`, `/test` run `scripts/ci/quiet.sh` on the changed workspaces and print one line per workspace, errors only on failure. Use them instead of `yarn lint` / `yarn check-ts` / `yarn test`.
- `PreToolUse` hooks (`.agents/hooks/claude.mjs`) refuse a whole-file read above 120 KB, by Read or by `cat` (Drizzle snapshots, `.po` catalogs, `routeTree.gen.ts`, vendored datasets): use Grep, or Read with offset/limit. They also refuse a hand edit of a generated file.
- `.claude/rules/` holds the deep-dive docs, path-scoped. A rule arrives on the **`Read` tool and on nothing else**: creating a file it covers injects nothing, and `cat` in a `Bash` call injects nothing. So `Read` a sibling file before scaffolding a new one, and prefer `Read` over `cat` on source files even where a harness preamble recommends the shell. They are rendered by `yarn agent:build` from `.agents/instructions/`, which is where a convention is edited.
