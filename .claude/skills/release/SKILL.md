---
name: release
description: Cut an OpenCRQ release from a commit of main - check its CI, draft the notes (highlights and the changelog of the issues closed since the previous release) for the release manager to review, then create the draft release and push its signed tag, which CI publishes once the image is on Docker Hub. Use when asked to cut, tag or prepare a release. Usage - /release <commit>
---

# Cut a release

Run by a release manager, in a local session, with their own `git` (signing configured) and `gh`.
The skill creates a **draft** and pushes its tag; it never publishes. CI's job `Publish the GitHub
Release`, on the tag, waits for `filigran/opencrq:<tag>` on Docker Hub, requires the draft, attaches
the SBOM and the image line, and publishes. Releases are immutable once published.

The one input is the last commit to include, any form `git rev-parse` reads.

Work in the scratchpad for the notes file, never in the repository.

## 1. Check and gather

```bash
node scripts/release.mjs prepare <commit> <scratchpad>/release-notes.md
```

It fetches `main` and the tags, then refuses, having pushed nothing, a commit that is not on `main`,
that a release already holds (its own tag or a later one: `main` has no maintenance branch), whose
latest CI run on `main` is not green, or whose `Hand over to the release repository` job did not
succeed; and a next number that a draft already holds, left by a run that never pushed its tag. On
a refusal, report the reason as printed and stop: never work around a check, and never delete a
draft the release manager has not confirmed is abandoned.

On success it prints the release as JSON (`repo`, `sha`, `version`, `previousTag`, `ciRun`,
`issues`) and writes the draft notes: a `## Highlights` placeholder,
then the changelog, which is the script's and is not rewritten by hand beyond what the release
manager asks.

## 2. Write the highlights

Replace the placeholder comment with a few sentences, for a user of the platform: what changes for
them, and what an upgrade needs (a breaking change, a configuration key added or renamed, a step
before or after the upgrade). Read the issues of the Breaking changes, Security and Enhancements
sections with `gh issue view` before writing; the Maintenance ones only when a title hints at an
upgrade step. No internal detail, no hub, no private repository, nothing an outside reader cannot
open.

While reading, list for the release manager any issue that reads as a breaking change but is not
under Breaking changes: its title lacks the `!` and it has no `breaking-change` label, and only this
review catches it.

**First release** (`previousTag` is null, the repository holds no earlier release tag): the script
writes no changelog. The highlights become a presentation of the product, what it does and how to
run it, referencing no issue and no pull request.

## 3. Review with the release manager

Show the whole notes file and the version, the commit and the previous tag. Apply every correction
asked, show the result again, and go on only on an explicit approval. This is the one judgement
call of the routine: do not shorten it.

## 4. Draft, then tag

Always in this order, so that no tag is ever left without its draft: CI fails a tag it finds none
on. A draft creates no tag; the signed tag pushed after it attaches to it, and publishing keeps that
tag, signature included. GitHub makes an unsigned tag of its own only when a draft is published
with no tag, which CI never does: it publishes from the tag's own run.

```bash
gh release create <version> --draft --target <sha> --title "<version>" --notes-file <scratchpad>/release-notes.md
git tag -s <version> <sha> -m "<version>"
git push origin refs/tags/<version>
```

If the push fails, remove the draft and the local tag, report git's error as printed, and stop:

```bash
gh release delete <version> --yes
git tag -d <version>
```

A refused push most often means the account is not a release manager (the tag ruleset): never push
a tag under another name to get around it. Never publish, and never mark Latest: the draft is CI's
to complete.

## 5. Hand over to CI

Report the draft's URL and the tag's CI run:

```bash
gh run list --workflow ci.yml --branch <version> --event push --limit 1 --json url,status
```

CI publishes when the image is served, within about 45 minutes of the tag's checks passing, then
marks Latest the highest published release, so an older commit's release never takes it. Until
then the release manager may still edit the draft's notes on GitHub; the title and notes stay
editable after publication, the assets do not.

Marking Latest runs one tag at a time: when a third tag queues behind a pending one, GitHub cancels
the pending run, and that tag's CI run shows cancelled although its release is published. Nothing to
re-run: the later tag's job marks the same release.

Never delete or move a release tag, and never delete a published release.
