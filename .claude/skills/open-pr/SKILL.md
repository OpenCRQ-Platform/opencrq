---
name: open-pr
description: Turn a finished change into a pull request in review - pre-flight checks, one conventional signed commit, push, a body from the repository template, the evidence handed over for the one drag-and-drop GitHub requires, then ready for review. Use when asked to open, submit or publish a PR for the current branch.
---

# Open the pull request

Run from the worktree that carries the change, on its own branch. The issue number comes from the
branch name. The evidence folder is the `evidence` path of
`node scripts/devenv.mjs status --json`, the call `verify-change` already reads.

## 1. Pre-flight, and stop on any red

- `git status` clean of anything you did not mean to commit, and `git diff main...HEAD --stat`
  read line by line for a stray file: a generated `fds.css`, a `development.local.json`, a
  screenshot that wandered inside the repository.
- Exactly **one** new migration versus `origin/main`:
  `git diff --name-only origin/main...HEAD -- module/src/db/migrations/*.sql`. More than one is
  reconciled, not explained.
- `/lint`, `/check-ts`, `/test` green, then `yarn check-ts` at the repository root: the root
  catches what a per-workspace run cannot see.
- Integration tests for what you touched, run from `integration-tests` only with this worktree's
  stack up. The suite reads `postgres.port` from `back/config/development.local.json`; if that
  file is absent, set `PGPORT` explicitly or start the stack first. Never accept evidence from a
  run that silently fell back to a shared 5432 container.
- `yarn i18n:check` from `front` when strings moved, `yarn agent:check` when an instruction moved,
  `yarn notice:check` when a data file was added or changed (`yarn notice:build` regenerates).
- The comments the diff adds re-read against the policy in `CLAUDE.md`, and every one that states
  nothing the code cannot show deleted.
- The change verified on the running instance, with its evidence (`verify-change`).

## 2. One commit, title only

```
type(scope): description (#issue)
```

Lowercase first letter, no trailing period, acronyms and proper nouns preserved, no body, and
nothing naming an AI tool anywhere in the message. Commits are signed by the global SSH
configuration, so a plain `git commit -m "<title>"` signs. Amend rather than stack "fix lint"
commits: the squash merge takes the PR title, but the branch history is still read during review.

Push with `git push -u origin HEAD`.

## 3. The body

Fill `.github/PULL_REQUEST_TEMPLATE.md`, keep its section order, delete its HTML comments. Write
it to a file and pass `--body-file`: a body typed inline gets mangled by quoting.

- **Proposed changes**: what the diff does, in the reviewer's terms. Two or three bullets.
- **Related issues**: `Closes #<issue>`. Every pull request is linked to an issue.
- **Type of change**: tick the one box that applies.
- **Screenshots / recordings**: write `_Attached below._` when there is evidence to drop, or state
  that the change has no UI surface.
- **How to test**: the steps you actually ran, with this worktree's ports replaced by the reader's
  own defaults (3000 / 3002), never the offsets this branch happens to own.

Never reference a local path, a private repository other than this one or anything else not public
(see *Links in public metadata* in `AGENTS.md`), or an AI tool. The title must end with
`(#<issue>)` or the squash-merge commit breaks the convention.

```bash
gh pr create --base main --draft --title "<title>" --body-file <path> --assignee "@me"
```

`gh pr create` never assigns the author on its own — `--assignee "@me"` is required, not optional.

Draft first, always: CI starts on a draft, and a failing check is cheaper to fix before anyone is
asked to look.

## 4. Labels: the ownership label, and nothing else the author controls

A pull request carries exactly one ownership label, `filigran team` or `community`. Type, area and
workflow labels are issue-only, and any that appear is removed. `vibe-coded` is the author's call,
so add it only when the user asks. Automatic language labels and `dependencies`, applied by
GitHub/Renovate, are not the author's concern and are left alone.

## 5. Evidence: the one manual step

The repository is **internal**, so an image renders in a PR body only when GitHub itself hosts it,
and that upload exists only as a drag-and-drop in the browser. No API, no `gh`, no raw URL
substitutes for it.

So: open the evidence folder, give the user the PR URL, and ask them to drop the files into the
*Screenshots / recordings* section. Say which file is which, in order. Then wait.

## 6. Ready for review

Once the user confirms the drop, or immediately when there was nothing to attach:

```bash
gh pr ready <number>
```

Then report in one block: the PR URL, its title, the state of the checks, and anything a reviewer
should know that the body does not carry. Say plainly if the change is security-sensitive (auth,
permissions, secrets, crypto): those need two approvals, and the user decides who.

Closing the issue and its `solved` label happen after the merge, not here.
