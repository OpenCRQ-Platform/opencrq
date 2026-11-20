---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mjs"
  - "**/*.js"
  - "**/*.sql"
---

<!-- Generated from .agents/instructions/code-comments.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

What a code comment is allowed to say, and the two tests that decide whether it may stay. The conventions below apply to the file being read.

# Code comments

A comment exists only to state a constraint the code itself cannot show: a non-obvious invariant ("caller guarantees the list is sorted"), a surprising why ("the API returns 200 on failure, hence this check"), or a trap ("call order matters: the lock is taken before the read"). JSDoc on exported functions, classes and complex logic follows the same bar: document the contract (inputs, guarantees, side effects), never restate the signature. These comment classes are forbidden:
- *Paraphrase*: restates what the next line does. Deleting it loses no information.
- *Diff commentary*: explains why the change is correct, addressed to the PR reviewer. That belongs in the PR description, not the code.
- *Session narration*: "new approach", "now uses X", "updated to handle Y". It describes the dev session and is stale the moment the PR merges.

Two tests decide whether a comment may stay. Deletion test: remove the comment; if a competent reader loses nothing they cannot recover from the code, it must not exist. Amnesia test: would the comment still make sense to someone who never saw this PR or dev session? If not, it is narration. Before finishing any task, reread the diff and delete every comment that fails either test. Comments must never reference local or non-committed files.

A pointer is only allowed when it names something in the tree: a file, a function, a test. An issue or pull request number (`#1234`) and a commit sha are not, nor is a planning document's own numbering (`decision 7`, `CAP-11`): the public repository starts without this one's history and issues, so those numbers lead nowhere or to an unrelated issue, and the planning documents live under the gitignored `.dev/`. State the constraint the issue or the decision settled instead. A comment that passes both tests is still cut to its kernel: one why, in the fewest sentences that let a reader accept the code as written. Delete, in this order, a second formulation of the point just made, a true but accessory consequence the constraint holds without, a repair recipe ("run X when this fails"), and a pointer to another file whose own comment already carries the explanation.

**No tombstones.** When code, an export, or a data entry is deleted, delete it fully — never leave a comment documenting that it "used to exist", was "retired", "removed", or "is no longer X". Git history is the record of what existed; comments must describe the current code only, not its absence or its past.
