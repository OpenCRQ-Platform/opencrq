---
name: check-ts
description: Incremental tsc --noEmit on the changed workspaces and their dependents (or the ones given), one OK line per workspace, error lines only on failure. Usage - /check-ts [ws...]
---

Run exactly this command and relay its output as-is. Never run tsc by hand and never open the full log unless a printed line is truncated.

```
bash scripts/ci/quiet.sh ts
```

Append the workspace names the user named after the command, for example `bash scripts/ci/quiet.sh ts back front`. Only workspace names are accepted: the ts step takes no flags. With nothing named, run it exactly as written: it picks the changed workspaces itself.

OK lines: report them in one sentence. FAIL lines: fix every listed error, then re-run the same command until it prints OK.
