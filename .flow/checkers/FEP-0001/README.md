# The checker of FEP-0001

It verifies one rule of FEP-0001 in a product repository: an implementation pull request cites its approved RFC and
the slice of the RFC's delivery plan it delivers, names its public ticket, and, but for a bug fix, the RFC's PRD is
approved and planned (FEP-0001 3.1). It is the method's checker, as a
guideline's checker is its guideline's: it lives on the central repository's main, and the distribution brings it to
every repository that `registry/repositories.yaml` marks `distribute` (FEP-0003 3.3).

## What it reads

- The pull request's body: `Implements: RFC-<CODE>-NNNN MS-001` - the RFC and its slice -, and its public ticket,
  `Closes #123`, or `Refs #123` for a slice that is not the last; `Bug: #123`, the line of before, counts as the ticket, and so does a vulnerability's security
  advisory, `Refs GHSA-xxxx-xxxx-xxxx`, private until it is published with the fix.
  A bug fix cites its RFC the same way: the RFC tells it, its `prd` empty.
- The RFC's and its PRD's frontmatter, in a checkout of the central repository: their status, the RFC's `prd`, the
  PRD's `planning.quarter`; the slice ids of the RFC's section *Delivery plan and commitment*.
- The files the pull request changes, and the diff of its CI configuration.
- Its author and its labels, and the branch it comes from.

## What passes without a document

| Case | How it is told |
|---|---|
| Documentation, CI configuration or translations only | every changed file matches the exempt paths, `FLOW_EXEMPT_PATHS` to replace them |
| A dependency bot's update | the author is `renovate[bot]` or `dependabot[bot]` |
| A release | a maintainer's label `flow:release` |
| The distribution's own pull request | its branch is `flow/distribution` and every file it changes is as a `distributed.json` records it |
| A pull request from a fork | a maintainer's label `flow:rfc-verified`, once they checked its link; before the repository's date, its absence only warns, the date read from the target branch, never from the fork's code |

A change of CI configuration that touches a workflow's permissions, secrets or triggers, or a step that publishes a
release, is a bug fix that cites its RFC: no case above covers it, but the distribution's own pull request.

## From when it blocks

Each repository has its own date, which the registry sets and `distributed.json` records as `enforce_from`; without
one, it blocks now. Before that date, a pull request without an approved RFC passes with a warning that starts with
`Filigran Flow - not blocking until`, which the Flow app counts; after it, it blocks, but for a pull request opened
before it, which still only warns. A team adopts Flow gradually, and its work in flight never needs a document after
the fact (FEP-0001 3.1).

A missing slice or ticket follows the same rule with a later date: it warns until 2027-01-04, or until the
repository's date when that is later, and blocks after it (owner, 2026-11-15). A slice the RFC's delivery plan does not
hold blocks from the repository's date, as an RFC that does not exist.

## How to run it

    PR_BODY=$'Implements: RFC-FLOW-0002 MS-001\nCloses #12' python3 check.py --specs <checkout of the central repository>

## In a product repository

The distribution copies `check.py` and this file to `.flow/checkers/FEP-0001/`, with a `distributed.json` that names
their source and the SHA-256 of each file, and `workflow.yml` to `.github/workflows/flow-fep-0001.yml`. Its job,
`FEP-0001`, runs on every pull request, merge queue and push to the default branch; the gate "Flow checkers" waits for
it. It reads the central repository with the secret `FLOW_TOKEN`, read-only on it, which an administrator sets once;
without it, a pull request that cites an RFC fails and says so. Logs of a public repository are public: it prints only
ids and statuses, never a document's content (FEP-0007 3.1).

## What it does not see

- Whether the code does what the RFC says: the Principal checks it in review until the conformance judge exists
  (FEP-0006).
- A pull request that edits this checker or its workflow and removes the check: the job runs the pull request's own
  copy. The defence is the Principal's review and the Flow app's conformance view, which shows a copy that differs
  from the distributed one.
- A pull request on the branch `flow/distribution` that writes a file and its record together: it passes as the
  distribution's. Only the Flow GitHub App writes that branch; the Principal reviews its pull request.
