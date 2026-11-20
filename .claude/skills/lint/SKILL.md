---
name: lint
description: ESLint on the changed workspaces (or the ones given), one OK line per workspace, errors only on failure. Usage - /lint [ws...] [--fix]
---

Run exactly this command and relay its output as-is. Never run eslint by hand and never open the full log unless a printed line is truncated.

```
bash scripts/ci/quiet.sh lint
```

Append whatever the user named after the command, workspaces and flags alike. With nothing named, run it exactly as written: it picks the changed workspaces itself.

OK lines: report them in one sentence. FAIL lines: fix every listed error, then re-run the same command until it prints OK.
