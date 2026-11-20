/**
 * What `/release` checks and gathers before anything is pushed: the commit, on `main` and with a
 * green CI run whose hand-over passed; the version; the previous release; the changelog's issues.
 * Reads through the release manager's own `git` and `gh`.
 */

import { releasedIssues, renderChangelog } from './changelog.mjs';
import { highestRelease, isRelease, MAJOR, nextReleaseNumber, tagNames } from './lib.mjs';
import { findRelease } from './publish.mjs';

const HAND_OVER_JOB = 'Hand over to the release repository';

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const graphql = (gh, query) => JSON.parse(gh('api', 'graphql', '-f', `query=${query}`)).data.repository;

/**
 * The pull requests merged as one of `commits`, with the issues of this repository each one
 * references as closing. Those merged into another branch need no filter: an issue only closes from
 * a pull request into the default branch, which `releasedIssues` checks.
 */
const mergedPullRequests = ({ gh, owner, name, commits }) => {
  const pulls = [];
  for (const chunk of chunks(commits, 40)) {
    const fields = chunk.map((oid, i) => `c${i}: object(oid: "${oid}") { ... on Commit { oid associatedPullRequests(first: 5) { nodes {
      number mergeCommit { oid }
      closingIssuesReferences(first: 25) { nodes { number repository { nameWithOwner } } }
    } } } }`);
    const repository = graphql(gh, `{ repository(owner: "${owner}", name: "${name}") { ${fields.join('\n')} } }`);
    for (const commit of Object.values(repository)) {
      for (const pull of commit?.associatedPullRequests.nodes ?? []) {
        if (pull.mergeCommit?.oid === commit.oid) {
          pulls.push({
            number: pull.number,
            issues: pull.closingIssuesReferences.nodes
              .filter((issue) => issue.repository.nameWithOwner === `${owner}/${name}`)
              .map((issue) => issue.number),
          });
        }
      }
    }
  }
  return pulls;
};

/** The issues `numbers` name, with what the changelog reads of each. */
const issueDetails = ({ gh, owner, name, numbers }) => {
  const issues = [];
  for (const chunk of chunks(numbers, 40)) {
    const fields = chunk.map((number) => `i${number}: issue(number: ${number}) {
      number title state issueType { name } labels(first: 50) { nodes { name } }
      timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent {
        closer { __typename ... on PullRequest { number } ... on Commit { oid } }
      } } }
    }`);
    const repository = graphql(gh, `{ repository(owner: "${owner}", name: "${name}") { ${fields.join('\n')} } }`);
    for (const issue of Object.values(repository)) {
      if (issue === null) {
        continue;
      }
      const closer = issue.timelineItems.nodes[0]?.closer ?? null;
      issues.push({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        type: issue.issueType?.name ?? null,
        labels: issue.labels.nodes.map((label) => label.name),
        closer: closer === null ? null : { pullRequest: closer.number ?? null, commit: closer.oid ?? null },
      });
    }
  }
  return issues;
};

/** The CI run of `sha` on `main`, refused unless it and its hand-over succeeded. */
const greenRun = ({ gh, repo, sha }) => {
  const { workflow_runs: runs } = JSON.parse(gh('api', `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=20`));
  const run = runs.sort((a, b) => b.run_number - a.run_number)[0];
  if (run === undefined) {
    throw new Error(`${sha} has no CI run on main`);
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`the CI run of ${sha} is ${run.conclusion ?? run.status}: ${run.html_url}`);
  }
  const { jobs } = JSON.parse(gh('api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`));
  const handOver = jobs.find((job) => job.name === HAND_OVER_JOB);
  if (handOver?.conclusion !== 'success') {
    throw new Error(`"${HAND_OVER_JOB}" is ${handOver?.conclusion ?? 'missing'} in ${run.html_url}`);
  }
  return run.html_url;
};

/**
 * Checks the commit `input` names and gathers what its release needs. Throws, having changed nothing
 * on origin, on a commit that is not on `main`, that a release already holds or whose CI is not
 * green, and when the next number already has a draft.
 */
export const prepareRelease = ({ git, gitOk, gh, input, today }) => {
  git('fetch', '--quiet', '--force', '--tags', 'origin', 'main');
  const repo = gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner').trim();
  const [owner, name] = repo.split('/');

  const sha = git('rev-parse', '--verify', '--end-of-options', `${input}^{commit}`).trim();
  if (!gitOk('merge-base', '--is-ancestor', sha, 'origin/main')) {
    throw new Error(`${sha} is not on main`);
  }
  // Main has no maintenance branch: a commit a release already holds, its own or a later one's,
  // would go out under a higher number than code newer than it.
  const heldBy = git('tag', '--contains', sha).split('\n').filter(isRelease);
  if (heldBy.length > 0) {
    throw new Error(`${sha} is already in ${heldBy.join(', ')}: release a commit after it`);
  }
  const ciRun = greenRun({ gh, repo, sha });

  const version = nextReleaseNumber({ major: MAJOR, date: today, tags: tagNames(git('ls-remote', '--tags', 'origin')) });
  // A draft is created before its tag, so one whose tag never came holds the next number.
  const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)).flat();
  const { state, release } = findRelease(releases, version);
  if (state !== 'missing') {
    throw new Error(`${version} already has a ${state} release, with no tag on origin: ${release.html_url}. Delete it if it was abandoned`);
  }

  const previousTag = highestRelease(git('tag', '--merged', sha).split('\n'), version);
  if (previousTag === null) {
    return { repo, sha, version, previousTag, ciRun, changelog: null, issues: 0 };
  }

  const commits = git('rev-list', '--first-parent', `${previousTag}..${sha}`).split('\n').filter(Boolean);
  const pulls = mergedPullRequests({ gh, owner, name, commits });
  const numbers = [...new Set(pulls.flatMap((pull) => pull.issues))];
  const issues = releasedIssues({
    issues: issueDetails({ gh, owner, name, numbers }),
    pullRequests: new Set(pulls.map((pull) => pull.number)),
    commits: new Set(commits),
  });
  const changelog = renderChangelog({ issues, compareUrl: `https://github.com/${repo}/compare/${previousTag}...${version}` });
  return { repo, sha, version, previousTag, ciRun, changelog, issues: issues.length };
};
