---
name: devenv
description: Start this worktree's development stack (containers, backend, frontend) and get the URLs to test against. Use before opening the app in a browser, or when a change has to be checked on a running instance. Usage - /devenv [up|status|down|logs|snapshots]
---

Run the command and relay what it prints. Never start `yarn dev` by hand and never assume port 3000: every worktree has its own ports.

```
node scripts/devenv.mjs up --json
```

Read `frontend` from the JSON and use that URL for anything opened in a browser. `--json` implies no install, reset or seed, and never asks a question.

The stack runs its own XTM One, and signing in goes through it: `xtmOne` is its URL, `xtmOneAdmin` its own administrator (XTM One's, and OpenCRQ's super administrator), and `mailpit` the web UI holding every email XTM One sent. When `xtmOneLocal` is `false`, the worktree's `infra/local/.env` sets `XTM_ONE_LOCAL=false`: something else serves the `xtmOne` port, the stack's own XTM One is not started, and `xtmOneAdmin` from `up` is `null`. That line is the user's: never add or remove it yourself. A stand-in serving the `xtmOne` port may write it through its own attach and detach, run by the user or by a skill they invoked, never on your own initiative. The first `up` of a worktree takes longer, waiting for XTM One to create its database: usually a minute or two, up to ten under amd64 emulation on Apple silicon, which is XTM One's health check start period. Let it run rather than conclude it hung. When the user asks how to sign in, relay `docs/development/development.md#signing-in`: the `frontend` URL sends them straight to XTM One's sign-in page, there being no OpenCRQ password; a seeded email and the seeded password work there, and `xtmOneAdmin` is the super administrator, once the stack's XTM One sends the `xtm_super_admin` claim.

- `node scripts/devenv.mjs status --json` — is it already running, and on which ports. Cheaper than `up` when the stack is already there.
- `node scripts/devenv.mjs logs back` — why the backend did not come up. It runs in the background, so its errors are only in the log.
- `node scripts/devenv.mjs down` — stop this worktree's stack.
- `node scripts/devenv.mjs snapshots --dir <path>` — the database snapshots in a directory, one of which may already hold the connector ingestions a task needs. The directory is never guessed: ask the user where theirs is.

Dependencies, a database reset, the demo seed and a snapshot restore are deliberately out of reach of `--json`: they are destructive or interactive. When one is needed, ask the user to run `yarn env:up --install`, `--reset` or `--seed`, or `yarn env:restore <name>`, from their terminal.

A stack is Community Edition until its XTM One holds a Filigran license: a user reaches **one tenant**, the seeded admin landing on Acme Bank, and creating a second tenant is refused. A task about several tenants, or about another Enterprise Edition feature, needs a license installed in the stack's XTM One (its Settings › License page, or `XTM_ONE_ENTERPRISE_LICENSE` exported in the user's shell before `yarn env:up`), which OpenCRQ then verifies as a deployment does. Installing one is the user's call, like the reset and the seed, and the license is theirs to provide: ask them, and never look for one or commit one. Details: `docs/development/development.md#enterprise-edition-locally`.

Full reference: `docs/development/development.md#running-the-app-locally`.
