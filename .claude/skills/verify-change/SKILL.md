---
name: verify-change
description: Prove a change works on this worktree's own running instance and leave the evidence a pull request will cite - real-mouse browser pass with before/after screenshots and a GIF, or a recorded backend probe when there is no UI. Use after implementing a fix, or when asked to test, verify or screenshot a change on the running app.
---

# Verify a change on the running instance

Ports, URLs and the evidence folder all come from one call, and nothing here writes inside the git worktree:

```
node scripts/devenv.mjs status --json
```

It prints an array holding only this worktree's row (`status --all --json` lists every worktree); read `frontend`, `backend`, `healthcheck` and `evidence` from that row. An empty array means nothing is allocated yet for this worktree: run `up` (below) first. Never assume port 3000: every worktree has its own.

## 1. Is the instance up

`running` on that row says so. When something is down:

```
node scripts/devenv.mjs up --json
```

It starts what is missing and leaves the rest alone. The servers outlive this session, so starting them here is safe and is the expected move. If one does not come up, the reason is in its log, since it runs in the background: `node scripts/devenv.mjs logs back`.

The backend recompiles on save, so after a backend edit poll the healthcheck port until it answers again rather than testing the old binary.

## 2. UI change: a real browser pass

The pass needs real clicks, screenshots, a recording of an interaction, the console and the network log. Use the browser tool the session has, and open a **new tab** on the `frontend` URL unless the user pointed at one of theirs.

- **Claude in Chrome**: load its tools in **one** call, then `tabs_context_mcp` first:

  ```
  ToolSearch select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__gif_creator,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__read_network_requests
  ```

- **Playwright MCP**: its `browser_*` tools cover the same ground (navigate, click, screenshot, evaluate, console messages, network requests).

When no browser tool is loaded, say so and ask the user to connect one (`/chrome` for Claude in Chrome) rather than skipping the pass.

**Login.** Each worktree owns its own port, so its cookies are its own and the session starts logged out. Log in yourself, through the worktree's own XTM One, with the seeded admin this worktree already carries: `platform_seed.admin` in `back/config/development.local.json`, the same pair `scripts/perf/estate-bench.mjs` reads. Read that field alone, never the whole file, which holds other secrets:

```
node -p "JSON.stringify(require('./back/config/development.local.json').platform_seed ?? null)"
```

Opening the `frontend` URL sends the browser straight to XTM One's sign-in page (the `xtmOne` URL of the status row), there being no OpenCRQ password; type the pair there and submit, and XTM One sends you back to OpenCRQ signed in, with no consent or terms page between. The other seeded users (`alice`, `bob`, `charlie`, `eve` `@example.com`) share the admin's password. The super administrator, with every right in every tenant, is XTM One's own administrator, `xtmOneAdmin` in `node scripts/devenv.mjs status --json`; it signs in as a user with no access while the stack's XTM One image sends no `xtm_super_admin` claim, which the published `rolling` image does not yet. Without a `platform_seed` block, that account is the only one there is. XTM One keeps its own session in the browser: signing out of OpenCRQ and back in returns as the same user, so to switch users sign out of XTM One as well, or remove its `copilot_token` from the `xtmOne` origin's local storage.

The pair passes through your tool calls, so it lands in the session transcript: that is acceptable only because it is a throwaway credential on a local database that gets wiped, and it needs no permission. Past the transcript it goes nowhere: typed into this worktree's own instance and no other, never in a capture, a commit or a pull request. Ask rather than log in when the block is missing (unless XTM One's administrator is the account the change needs), `enabled` is false, or the password looks like a real one rather than a throwaway such as `Admin1234!`, since `yarn seed:setup-dev` lets the developer type any.

**The rule that matters.** Validate the interaction path with real mouse clicks only. A click that misses is a **result**, not a tooling obstacle: never reach for `element.dispatchEvent(new MouseEvent(...))` to get past it, because a synthetic event bypasses `pointer-events`, hit-testing and stacking order, so it succeeds exactly where the user fails. When a click misses, diagnose before concluding:

```js
getComputedStyle(el).pointerEvents
document.elementFromPoint(cx, cy)   // not inside the target? the app is broken, not the tool
```

Synthetic events stay fine for *preparing* state (navigating, filling a field), never for validating that a control is reachable.

Do not trigger `alert`, `confirm` or a browser modal: it blocks every later tool call. Read the console through the tool (filtered when it is noisy) instead of adding logs.

**If the database holds real data** restored from a dump rather than seeded, mask it in the page before every capture, never on the image afterwards, and look at the shot yourself before it goes anywhere. Nothing quoting a real name, address or account goes into a pull request either.

**What to capture**, into the evidence folder, numbered so the order reads by itself:

- `01-before-<what>.png` on the broken behaviour when it is still reproducible (a fix without a "before" is a fix nobody can weigh),
- `02-after-<what>.png` on the same view once fixed,
- `03-<flow>.gif` when the change is an interaction rather than a state, with extra frames before and after each action so the playback is readable (`gif_creator` in Claude in Chrome; with a tool that records none, a numbered screenshot per step instead),
- one shot per surface the change reaches, not one per click.

Then check the console for a new error, and check the change did not break the neighbouring view. Both themes only when the change is visual.

## 3. Backend or data change: a recorded probe

No browser. Produce a text file in the evidence folder that a reviewer could re-run:

- the command, verbatim, and its output (a `curl` on the endpoint, a test run, a SQL read through this worktree's own Postgres port, the healthcheck or metrics page);
- for a behaviour change, the same probe before and after, or the failing test that now passes;
- name it `NN-<what>.txt`.

A migration also earns a probe: the table, its trigger and its indexes read back from this worktree's database.

## 4. Report

State plainly what you exercised, what you saw, and what you did not cover. A partial pass said plainly is worth more than a green claim: the one failure mode this skill exists to prevent is announcing a verified pass on a control that was never actually clickable.
