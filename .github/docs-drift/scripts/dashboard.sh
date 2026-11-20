#!/usr/bin/env bash
set -euo pipefail

issue="$1"
prs="$2"
last_run="$3"
mode="$4"
run_page="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/workflows/docs-drift-check.yml"

# Plain bullets, not checkboxes: a box reads as an action this issue does not offer.
listing() {
  jq -r --arg state "$1" --argjson limit "$2" '
    def docname: if test("fix drift in ") then sub(".*fix drift in "; "") | sub(" \\(#.*$"; "") else . end;
    [ .[] | select((.headRefName | startswith("docs-drift/")) and .state == $state) ]
    | sort_by(-.number) as $all
    | ($all[:$limit] | map("- #\(.number) `\(.title | docname)`"))
      + (if ($all | length) > $limit then ["- and \($all | length - $limit) older"] else [] end)
    | join("\n")
  ' "$prs"
}

open_list=$(listing OPEN 200)
[ -n "$open_list" ] || open_list="_No open drift pull request._"
accepted_list=$(listing MERGED 10)
dismissed_list=$(listing CLOSED 10)

dash=$(cat <<EOF
**Last run:** $last_run (\`$mode\`)

**Run a check**

Open [the workflow]($run_page), click **Run workflow** and pick a mode:
\`incremental\` audits the recent window, \`deep\` every mapped document. To audit
some documents only, give their paths or a common prefix, such as
\`docs/deployment/\`, in the scope field, separated by spaces. Running a check
needs write access to the repository.

**Open drift pull requests**

$open_list

Merge one to accept the correction, close it without merging to dismiss the
finding: it is never raised again while the passage it quotes stays as it is.
To revisit a dismissed finding later, reopen its closed pull request: the branch
and the proposed fix are still there.

<details><summary>Already settled</summary>

Accepted, most recent first:

${accepted_list:-_None yet._}

Dismissed, most recent first:

${dismissed_list:-_None yet._}

</details>
EOF
)

body=$(gh issue view "$issue" --json body --jq .body)
if grep -q 'drift-dashboard:start' <<<"$body"; then
  new_body=$(printf '%s\n' "$body" | DASH="$dash" awk '
    /<!-- drift-dashboard:start -->/ { print; printf "%s\n", ENVIRON["DASH"]; skip = 1; next }
    /<!-- drift-dashboard:end -->/ { skip = 0 }
    skip != 1 { print }
  ')
else
  new_body=$(printf '%s\n\n<!-- drift-dashboard:start -->\n%s\n<!-- drift-dashboard:end -->\n' "$body" "$dash")
fi

gh issue edit "$issue" --body "$new_body"
