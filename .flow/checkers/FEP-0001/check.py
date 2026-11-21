#!/usr/bin/env python3
"""Filigran Flow - the checker of FEP-0001: an implementation pull request cites its approved RFC (FEP-0001 3.1, FEP-0007 3.1).

The method's checker, as a guideline's is its guideline's: the distribution brings it to every product repository
(FEP-0003 3.3) as .flow/checkers/FEP-0001/check.py, run by .github/workflows/flow-fep-0001.yml, whose job, FEP-0001, the
gate "Flow checkers" waits for. It blocks from the repository's date - `enforce_from` in its distributed.json, from
the registry; none blocks now -: before it, and for a pull request opened before it, what is missing is a warning and
the job passes, so that a team adopts Flow gradually (FEP-0001 3.1, owner, 2026-11-15). Standard library only. The pull request body must contain
    Implements: RFC-OCTI-0012 MS-001   (the RFC approved, its PRD approved and planned, MS-001 a slice of its delivery plan)
    Closes #123                        (its public ticket - Refs #123 for a slice that is not the last)
A bug fix cites its RFC the same way: the RFC tells a bug fix, its `prd` empty (FEP-0001 3.1). A missing slice or ticket
warns until 2027-01-04 and blocks after it, from the repository's date (owner, 2026-11-15); `Bug: #123` still counts as
the ticket, and so does a vulnerability's security advisory, `Refs GHSA-xxxx-xxxx-xxxx`.
An automated dependency update (PR_AUTHOR renovate[bot] or dependabot[bot]) needs no document, nor
does a pull request that changes only documentation, CI configuration or translations (the files of
--changed-files all match --exempt-paths): the CI validates them (FEP-0001 3.1, GDL-XTM-0002) - but a change of CI
configuration that touches a workflow's permissions, secrets or triggers, or a step that builds, signs or publishes a
release (the lines --ci-diff adds or removes), is a bug fix that cites its RFC (FEP-0001 3.1, owner, 2026-10-21).

The distribution's own pull request - its branch flow/distribution, every file it changes as a distributed.json
records it - needs no document: Flow wrote it, and the product's Principal reviews it (FEP-0003 3.3).

    PR_BODY="..." python3 check.py --specs <checkout of the central repository>

Logs of public repositories are public: only ids and statuses are printed, never RFC content
(FEP-0007 3.1).
"""
from __future__ import annotations

import argparse
import datetime
import fnmatch
import hashlib
import json
import os
import re
import sys
from pathlib import Path

IMPLEMENTS = re.compile(r"^\s*Implements:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
RFC_ID = re.compile(r"\bRFC-[A-Z]{2,6}-P?\d{4}\b")
SLICE_ID = re.compile(r"\bMS-\d{3}\b")
# The public ticket: a closing keyword GitHub reads, Refs for a slice that is not the last, Bug: as before 2026-11-15;
# a vulnerability's security advisory, private until it is published with the fix (FEP-0001 3.1, owner, 2026-11-15).
TICKET = re.compile(r"^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|bug)\b:?\s*"
                    r"(#\d+|[\w.-]+/[\w.-]+#\d+|https://github\.com/[\w.-]+/[\w.-]+/(?:issues/\d+|security/advisories/GHSA[\w-]+)"
                    r"|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})", re.IGNORECASE | re.MULTILINE)
SLICE_AND_TICKET_FROM = datetime.date(2027, 1, 4)   # a missing slice or ticket blocks from this date (owner, 2026-11-15)
DEPENDENCY_BOTS = {"renovate[bot]", "dependabot[bot]"}
# Documentation, CI configuration and translations (FEP-0001 3.1); a repository may pass its own list.
# What makes a change of CI configuration sensitive: the supply chain of a release (FEP-0001 3.1).
SENSITIVE_CI = [
    ("permissions", re.compile(r"^\s*(permissions:|[a-z-]+:\s*(write|read-all|write-all)\b)")),
    ("secrets", re.compile(r"secrets\.|secrets:")),
    ("triggers", re.compile(r"^\s*(on:|pull_request_target|workflow_run|workflow_dispatch|workflow_call|repository_dispatch|schedule:|push:|pull_request:|release:|tags:|branches:)")),
    ("release steps", re.compile(r"npm publish|yarn publish|docker push|docker/build-push-action|gh release|softprops/action-gh-release|goreleaser|"
                                 r"twine upload|pypa/gh-action-pypi-publish|cargo publish|mvn deploy|gradle publish|helm push|cosign|sigstore|"
                                 r"actions/attest|upload-release-asset", re.IGNORECASE)),
]


def sensitive_ci(diff: str) -> list[str]:
    """What a diff of CI configuration touches among the sensitive parts: the lines it adds or removes (FEP-0001 3.1)."""
    lines = [line[1:] for line in diff.splitlines()
             if line[:1] in "+-" and not line.startswith(("+++", "---"))]
    return [what for what, rx in SENSITIVE_CI if any(rx.search(line) for line in lines)]


DISTRIBUTION_BRANCH = "flow/distribution"   # the branch the distribution's pull request comes from (FEP-0003 3.3)
WARNING = "Filigran Flow - not blocking until"   # the Flow app counts the merged pull requests that carry it


def enforce_from(repo: Path) -> datetime.date | None:
    """The date the check blocks from in this repository, which the distribution records from the registry; None
    when it records none - the check blocks now."""
    try:
        value = json.loads((repo / ".flow/checkers/FEP-0001/distributed.json").read_text(encoding="utf-8")).get("enforce_from")
        return datetime.date.fromisoformat(str(value)) if value else None
    except (OSError, ValueError, AttributeError):
        return None


def lenient(since: datetime.date | None) -> bool:
    """Whether what is missing only warns: before the date, or for a pull request opened before it."""
    if since is None:
        return False
    today = datetime.date.fromisoformat(os.environ["FLOW_TODAY"]) if os.environ.get("FLOW_TODAY") else datetime.datetime.now(datetime.timezone.utc).date()
    opened = os.environ.get("PR_CREATED_AT", "")[:10]
    return today < since or (bool(opened) and datetime.date.fromisoformat(opened) < since)


def distributed_only(repo: Path, files: list[str]) -> bool:
    """Whether every file a pull request changes is as the distribution wrote it: its SHA-256 the one a checker's
    distributed.json records - among its files, or as the gate it came with -, a record itself, or removed while no
    record names it any more - a checker withdrawn."""
    recorded: dict[str, str] = {}
    records = set()
    for sidecar in repo.glob(".flow/checkers/*/distributed.json"):
        records.add(sidecar.relative_to(repo).as_posix())
        try:
            named = json.loads(sidecar.read_text(encoding="utf-8")).get("files")
        except (ValueError, AttributeError):
            return False
        recorded.update(named if isinstance(named, dict) else {})
        gate = json.loads(sidecar.read_text(encoding="utf-8")).get("gate")
        recorded.update(gate if isinstance(gate, dict) else {})
    for f in files:
        path = repo / f
        if f in records:
            continue
        if path.is_file():
            if recorded.get(f) != hashlib.sha256(path.read_bytes()).hexdigest():
                return False
        elif f in recorded:
            return False
    return bool(files)


RELEASE_LABEL = "flow:release"   # a release pull request - a version set, release notes - cites no document (FEP-0001 3.1)
EXEMPT_PATHS = ["docs/*", "*.md", "*.mdx", "*.rst", ".github/*", ".circleci/*", ".gitlab-ci.yml", "Jenkinsfile",
                "lang/*", "*/lang/*", "locales/*", "*/locales/*", "i18n/*", "*/i18n/*", "*.po", "*/translations/*"]
STATUS = re.compile(r"^status:\s*([a-z-]+)", re.MULTILINE)
PRD_FIELD = re.compile(r"^prd:\s*(PRD-P?\d{4})\b", re.MULTILINE)
QUARTER = re.compile(r"^planning:\s*(?:#.*)?\n(?:[ \t]+.*\n)*?[ \t]+quarter:\s*[\"']?(\d{4}-Q[1-4])", re.MULTILINE)


def head_of(folder_glob: list[Path], name: str) -> str | None:
    for folder in sorted(folder_glob):
        doc = folder / name
        if doc.exists():
            return doc.read_text(encoding="utf-8").split("\n---\n", 1)[0] + "\n"
    return None


def slices(specs: Path, rfc_id: str) -> set[str]:
    """The slice ids of the RFC's delivery plan - the rows of its section Delivery plan and commitment."""
    for folder in sorted((specs / "rfcs").glob(f"{rfc_id}-*")):
        doc = folder / "rfc.md"
        if doc.exists():
            plan = re.split(r"^## Delivery plan\b.*$", doc.read_text(encoding="utf-8"), maxsplit=1, flags=re.MULTILINE)
            section = re.split(r"^## ", plan[1], maxsplit=1, flags=re.MULTILINE)[0] if len(plan) == 2 else ""
            return set(re.findall(r"^\|\s*(MS-\d{3})\s*\|", section, re.MULTILINE))
    return set()


def rfc_status(specs: Path, rfc_id: str) -> str | None:
    head = head_of(list((specs / "rfcs").glob(f"{rfc_id}-*")), "rfc.md")
    if head is None:
        return None
    m = STATUS.search(head)
    return m.group(1) if m else "unknown"


def prd_problem(specs: Path, rfc_id: str) -> str | None:
    """What keeps the RFC's PRD from allowing the implementation: approved and planned (FEP-0001 3.1); None when fine."""
    head = head_of(list((specs / "rfcs").glob(f"{rfc_id}-*")), "rfc.md") or ""
    m = PRD_FIELD.search(head)
    if not m:
        return None                                   # a bug fix: no PRD
    prd_id = m.group(1)
    prd = head_of(list((specs / "prds").glob(f"{prd_id}-*")), "prd.md")
    if prd is None:
        return (f"{rfc_id}'s PRD, {prd_id}, is not on the central repository's main, which a PRD reaches once approved"
                " - implement once it is approved and planned, or check its id")
    status = (STATUS.search(prd) or [None, "unknown"])[1]
    if status != "approved":
        return f"{rfc_id}'s PRD, {prd_id}, is '{status}' - implement once it is approved and planned"
    if not QUARTER.search(prd):
        return f"{rfc_id}'s PRD, {prd_id}, is not planned yet - implement once it has a quarter"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--specs", type=Path, help="checkout of the private central repository")
    parser.add_argument("--fork", action="store_true", help="a fork's pull request without the label flow:rfc-verified: "
                        "only the repository's date is read, from the target branch")
    parser.add_argument("--changed-files", type=Path, help="file listing the paths the pull request changes, one per line")
    parser.add_argument("--exempt-paths", default=",".join(EXEMPT_PATHS), help="comma-separated glob patterns that need no document")
    parser.add_argument("--ci-diff", type=Path, help="the diff of the pull request's CI configuration (.github, ...)")
    parser.add_argument("--repo", type=Path, default=Path("."), help="the product repository's checkout, at the pull request's head")
    args = parser.parse_args()

    since = enforce_from(args.repo)
    if args.fork:   # a fork cannot read the central repository: a maintainer checks its link (FEP-0001 3.1)
        problem = "pull request from a fork: the product team writes its RFC and PRD, then a maintainer adds the label flow:rfc-verified"
        if lenient(since):
            print(f"::warning::{WARNING} {since.isoformat()} in this repository: {problem} (FEP-0001 3.1)")
            return 0
        print(f"::error::Filigran Flow - {problem} (FEP-0001 3.1)")
        return 1
    if args.specs is None:
        parser.error("--specs is required")
    body = os.environ.get("PR_BODY", "")
    files = ([f.strip() for f in args.changed_files.read_text(encoding="utf-8").splitlines() if f.strip()]
             if args.changed_files and args.changed_files.exists() else [])
    # The distribution's pull request: Flow wrote every file it changes, the Principal reviews it (FEP-0003 3.3).
    if os.environ.get("PR_HEAD_REF", "") == DISTRIBUTION_BRANCH and distributed_only(args.repo, files):
        print("::notice::Filigran Flow - the distribution's pull request, every file as its record names it: no document needed (FEP-0003 3.3)")
        return 0
    # A change of CI configuration that touches what the rule lists is a bug fix, a dependency bot's or a release's
    # included: no exemption below covers it (FEP-0001 3.1, owner, 2026-10-21).
    touched = sensitive_ci(args.ci_diff.read_text(encoding="utf-8")) if args.ci_diff and args.ci_diff.exists() else []
    if touched:
        print(f"::notice::Filigran Flow - a CI change that touches its {', '.join(touched)}: a bug fix, which cites its RFC (FEP-0001 3.1)")
    elif os.environ.get("PR_AUTHOR", "") in DEPENDENCY_BOTS:
        print("::notice::Filigran Flow - automated dependency update: the CI validates it, no document needed (FEP-0001 3.1)")
        return 0
    if not touched and RELEASE_LABEL in {x.strip() for x in os.environ.get("PR_LABELS", "").split(",")}:
        print(f"::notice::Filigran Flow - a release pull request, labeled {RELEASE_LABEL} by a maintainer: no document needed (FEP-0001 3.1)")
        return 0
    if files:
        patterns = [x.strip() for x in args.exempt_paths.split(",") if x.strip()]
        if not touched and files and all(any(fnmatch.fnmatch(f, pat) for pat in patterns) for f in files):
            print("::notice::Filigran Flow - documentation, CI or translations only: no document needed (FEP-0001 3.1)")
            return 0
    lines = IMPLEMENTS.findall(body)
    ids = sorted({i for line in lines for i in RFC_ID.findall(line)})
    named = {i: {s for line in lines if i in RFC_ID.findall(line) for s in SLICE_ID.findall(line)} for i in ids}
    problems, later = [], []      # later: what blocks only from SLICE_AND_TICKET_FROM
    if ids and not args.specs.is_dir():
        problems.append("the central repository cannot be read: an administrator sets the secret FLOW_TOKEN, read-only on it")
        ids = []
    for rfc_id in ids:
        status = rfc_status(args.specs, rfc_id)
        if status is None:
            problems.append(f"{rfc_id} is not on the central repository's main, which an RFC reaches once approved"
                            " - implement approved RFCs only, or check its id")
        elif status != "approved":
            problems.append(f"{rfc_id} is '{status}' - implement approved RFCs only")
        elif problem := prd_problem(args.specs, rfc_id):
            problems.append(problem)
        else:
            print(f"::notice::{rfc_id} is approved")
        if status is not None:
            plan = slices(args.specs, rfc_id)
            if unknown := sorted(named[rfc_id] - plan):
                problems.append(f"{', '.join(unknown)} is not a slice of {rfc_id}'s delivery plan")
            elif not named[rfc_id]:
                later.append(f"name the slice of {rfc_id}'s delivery plan it delivers: 'Implements: {rfc_id} MS-001'")
    ticket = TICKET.search(body)
    if not ids and not problems:
        problems.append("cite the approved RFC it implements and the slice it delivers, 'Implements: RFC-XXX-NNNN MS-001' - "
                        "every pull request, a bug fix included -, and its public ticket, 'Closes #123'")
    elif ids and not ticket:
        later.append("name its public ticket: 'Closes #123', or 'Refs #123' for a slice that is not the last")
    elif ticket:   # an advisory's id stays out of a public log until it is published (FEP-0007 3.1)
        print(f"::notice::ticket {'a security advisory' if 'ghsa' in ticket.group(1).lower() else ticket.group(1)}")
    blocking = []
    for p in problems:
        if lenient(since):
            print(f"::warning::{WARNING} {since.isoformat()} in this repository: {p} (FEP-0001 3.1)")
        else:
            blocking.append(p)
    for p in later:
        until = max(since or SLICE_AND_TICKET_FROM, SLICE_AND_TICKET_FROM)
        if lenient(until):
            print(f"::warning::{WARNING} {until.isoformat()} in this repository: {p} (FEP-0001 3.1)")
        else:
            blocking.append(p)
    for p in blocking:
        print(f"::error::Filigran Flow - {p} (FEP-0001 3.1)")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
