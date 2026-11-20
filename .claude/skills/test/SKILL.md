---
name: test
description: Vitest (dot reporter, bail on first failure) on the changed workspaces (or the ones given), auto-detection never picks integration-tests or utils, one OK line per workspace, failing tests only on failure. Usage - /test [ws...] [-- <file pattern>]
---

Run exactly this command and relay its output as-is. Never run vitest by hand and never open the full log unless a printed line is truncated.

```
bash scripts/ci/quiet.sh test
```

Append whatever the user named after the command, workspaces and flags alike. With nothing named, run it exactly as written: it picks the changed workspaces itself.

OK lines: report them in one sentence. FAIL lines: fix the failing test or the code under test, then re-run the same command until it prints OK. Auto-detection skips integration-tests, and utils, which has no tests; naming integration-tests explicitly still runs it (see the integration-tests deep-dive doc).
