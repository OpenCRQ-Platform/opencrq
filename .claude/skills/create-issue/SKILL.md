---
name: create-issue
description: File a GitHub issue on this repository that follows its title, template, label and Type conventions - one issue per story, approved by the user before anything is published. Use when asked to open, file or create an issue, or to turn findings or a plan into issues.
---

# File an issue

Repository `OpenCRQ-Platform/opencrq`. Everything published is in **English**, whatever language
the conversation is in, and nothing reaches GitHub before the user has approved it.

## 1. Look for it first

```bash
gh issue list --state all --search "<distinctive words>"
```

Read the candidates rather than trusting their titles. An issue already open means you add a
comment, not a second issue. A closed one that reproduces is a **regression**: it earns its own
issue, which says so and links the old one.

## 2. One issue, one story

An issue is what one person picks up and finishes. Two surfaces, two issues, each standing on its
own and each reviewable alone; the dependency between them is a sentence in *Additional
information*, not a reason to merge them back together.

When several come out of one conversation, take them **one at a time** with the user: what it is,
why it is a defect or a need, and file it, drop it, or fold it into another. A grouped question
hides the one item that deserved a no.

## 3. Title

```
type(scope): description
```

Lowercase first letter, no trailing period, acronyms and proper nouns preserved, scope a lowercase
area (`findings`, `frontend`, `connectors`). **No `(#issue)` reference**: on an issue, the number
*is* the reference. Full taxonomy in `.github/LABELS.md`.

## 4. Body: the template that matches the type

| Title prefix | Template | Sections to fill |
| --- | --- | --- |
| `fix:` | `.github/ISSUE_TEMPLATE/1-bug_report.md` | Description, Environment, Reproducible steps, Expected output, Actual output, Additional information |
| `feat:` | `.github/ISSUE_TEMPLATE/2-feature_request.md` | Use case, Current workaround, Proposed solution, Additional information, If the feature request is approved, would you be willing to submit a PR? |
| `docs:` | `.github/ISSUE_TEMPLATE/3-documentation.yaml` | Documentation request, Additional context |
| any type, when the issue asks a question rather than reports or requests | `.github/ISSUE_TEMPLATE/4-question.md` | Prerequisites, Description, Environment, Additional information |
| everything else | the feature template, read as "what and why" | same |

Keep the section order, delete the HTML comments, and fill every section with substance: a bug
states what you expected and where that expectation comes from (the issue that shipped the
surface, the code, a sibling surface that does it differently). A feature that has an obvious
shape carries an `### Implementation notes` and an `## Acceptance` block, one assertion per line,
so the reviewer of the eventual pull request has something to check against.

Write the body to a file and pass `--body-file`. A body typed inline gets mangled by quoting.

```bash
gh issue create --repo OpenCRQ-Platform/opencrq --title "<title>" --body-file <path> --label "<type>" --label "needs triage" --assignee "@me"
```

`gh issue create` never assigns the author on its own — `--assignee "@me"` is required, not
optional, whenever the issue is one the user is about to pick up themselves (which is the case
whenever they ask for one to be filed as part of the current task).

## 5. Labels, then the Type field

One primary type label matching the prefix (`feat:` → `feature`, `fix:` → `bug`, `docs:` →
`documentation`), plus `needs triage`, plus area labels where they route the issue to someone. A
question also carries `question`, the label its template sets.
Type, area and workflow labels are **issue-only**: none of them belongs on a pull request.

`gh` has no `--type` flag, so the GitHub **Type** field goes through GraphQL, in two calls, with
the ids passed as variables (`-F`) rather than interpolated into the query:

```bash
iid=$(gh api graphql -f query='query { repository(owner:"OpenCRQ-Platform", name:"opencrq") { issue(number:NNN) { id } } }' -q '.data.repository.issue.id')
gh api graphql -F issueId="$iid" -F typeId="IT_kwDOBwKC6M4BFBtW" -f query='mutation($issueId:ID!,$typeId:ID!){ updateIssue(input:{id:$issueId, issueTypeId:$typeId}){ issue { number issueType { name } } } }'
```

`IT_kwDOBwKC6M4BFBtW` is Feature, `IT_kwDOBwKC6M4BFBtS` Bug, `IT_kwDOBwKC6M4BFBtQ` Task (every
other Conventional Commits type). Re-query
`organization(login:"OpenCRQ-Platform"){ issueTypes(first:20){ nodes { id name } } }` if an id ever
stops resolving.

## 6. What never goes in

An AI tool's name, a local path, a link to a private repository other than this one, or anything else not public (see
*Links in public metadata* in `AGENTS.md`), and any real person, customer or account: a
reproduction quotes what the field *is*, never what it held.

Screenshots cannot be attached through the API on this repository. Describe the evidence instead,
or hand the user the issue URL and the files to drop in themselves.

## 7. Report

The number, the URL, the labels and the Type actually set. If the Type call failed, say so: an
issue without it is the one thing a reader cannot see is missing.
