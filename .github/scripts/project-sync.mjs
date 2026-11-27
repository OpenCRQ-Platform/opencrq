/**
 * Keeps an organization project board in step with the issues and pull requests it tracks. Every
 * rule reads GitHub's current state and is idempotent, so one pass serves the reaction to an event
 * and the periodic reconciliation alike.
 *
 *   node .github/scripts/project-sync.mjs --project <org>/<number> [--dry-run]
 *     --issue <owner>/<repo>#<n>   an issue, repeatable
 *     --pr <owner>/<repo>#<n>      the issues of that repository the pull request closes, repeatable
 *     --all --repo <owner>/<repo>  every item of the board from these repositories, and their open
 *                                  issues missing from it; --repo is repeatable
 *
 * The token is read from GH_TOKEN or GITHUB_TOKEN. `--dry-run` prints the changes and writes nothing.
 * PR_PREVIOUS_BODY, the body a pull request had before an edit, adds the issues it no longer closes.
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const STATUS = {
  inbox: 'Inbox',
  backlog: 'Backlog',
  todo: 'Todo',
  inProgress: 'In progress',
  inReview: 'In review',
  toDemo: 'To demo',
  done: 'Done',
};

export const TRIAGE_LABEL = 'needs triage';

const CLOSING_REFERENCE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)/gi;

/** The issue numbers of `repo` that a pull request body closes with a keyword. */
export const closingNumbers = (body, repo) => {
  const numbers = new Set();
  for (const [, target, number] of (body ?? '').matchAll(CLOSING_REFERENCE)) {
    if (!target || target.toLowerCase() === repo.toLowerCase()) {
      numbers.add(Number(number));
    }
  }
  return [...numbers];
};

/**
 * What the board should look like for one issue.
 *
 * `issue.pullRequests` are the pull requests that close it, closed ones included, and
 * `issue.closedByMergedPr` the author of the merged pull request that closed it, if one did. `item`
 * is the issue's card on the board, absent when it has none. A `status` of null leaves the card
 * where it is.
 */
export const decide = (issue, item) => {
  const open = issue.state === 'OPEN';
  if (!item && !open) {
    return { skip: 'closed and not on the board' };
  }
  if (item?.archived && !open) {
    return { skip: 'closed and archived' };
  }

  const current = item?.status ?? null;
  const openPrs = issue.pullRequests.filter((pr) => pr.state === 'OPEN').sort((a, b) => a.number - b.number);
  let target = current;

  if (open) {
    if (openPrs.some((pr) => !pr.isDraft)) {
      target = STATUS.inReview;
    } else if (openPrs.length > 0) {
      target = STATUS.inProgress;
    } else if (current === STATUS.toDemo || current === STATUS.done) {
      target = STATUS.todo;
    } else if (
      (current === STATUS.inProgress || current === STATUS.inReview) &&
      issue.pullRequests.some((pr) => pr.state === 'CLOSED')
    ) {
      target = STATUS.todo;
    } else if (current === null) {
      target = STATUS.inbox;
    }
  } else if (issue.closedByMergedPr) {
    target = current === STATUS.done ? STATUS.done : STATUS.toDemo;
  } else {
    target = STATUS.done;
  }

  let assign = null;
  if (issue.assignees.length === 0) {
    const author = open ? openPrs[0]?.author : target === STATUS.toDemo ? issue.closedByMergedPr : null;
    if (author?.type === 'User') {
      assign = author.login;
    }
  }

  return {
    add: !item,
    unarchive: Boolean(item?.archived),
    status: target === current ? null : target,
    removeLabel: issue.labels.includes(TRIAGE_LABEL) && target !== STATUS.inbox,
    assign,
  };
};

const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id
      state
      assignees(first: 10) { nodes { login } }
      labels(first: 50) { nodes { id name } }
      closedByPullRequestsReferences(first: 25, includeClosedPrs: true) {
        nodes { number state isDraft merged author { __typename login } }
      }
      timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) {
        nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { merged author { __typename login } } } } }
      }
      projectItems(first: 20, includeArchived: true) {
        nodes {
          id
          isArchived
          project { id }
          fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        }
      }
    }
  }
}`;

const PROJECT_QUERY = `query($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
    }
  }
}`;

const PROJECT_ITEMS_QUERY = `query($id: ID!, $after: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { content { ... on Issue { number repository { nameWithOwner } } } }
      }
    }
  }
}`;

const OPEN_ISSUES_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, states: OPEN) {
      pageInfo { hasNextPage endCursor }
      nodes { number }
    }
  }
}`;

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 25) { nodes { number repository { nameWithOwner } } }
    }
  }
}`;

export const client = (token) => {
  const request = async (url, init) => {
    const response = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${response.status} ${body.message ?? ''}`.trim());
    }
    return body;
  };
  return {
    graphql: async (query, variables) => {
      const body = await request('https://api.github.com/graphql', {
        method: 'POST',
        body: JSON.stringify({ query, variables }),
      });
      if (body.errors?.length) {
        throw new Error(body.errors.map((error) => error.message).join('; '));
      }
      return body.data;
    },
    rest: (method, path, payload) =>
      request(`https://api.github.com/${path}`, { method, body: JSON.stringify(payload) }),
  };
};

const splitRepo = (repo) => {
  const [owner, name] = repo.split('/');
  return { owner, name };
};

const parseRef = (ref) => {
  const match = ref.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (!match) {
    throw new Error(`Not an <owner>/<repo>#<n> reference: ${ref}`);
  }
  return { repo: match[1], number: Number(match[2]) };
};

const paginate = async (gh, query, variables, pick) => {
  const nodes = [];
  let after = null;
  do {
    const page = pick(await gh.graphql(query, { ...variables, after }));
    nodes.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return nodes;
};

const author = (node) => (node ? { login: node.login, type: node.__typename } : null);

export const readIssue = async (gh, project, repo, number) => {
  const data = await gh.graphql(ISSUE_QUERY, { ...splitRepo(repo), number });
  const node = data.repository.issue;
  if (!node) {
    return null;
  }
  const closer = node.timelineItems.nodes[0]?.closer;
  const card = node.projectItems.nodes.find((projectItem) => projectItem.project.id === project.id);
  return {
    issue: {
      id: node.id,
      state: node.state,
      assignees: node.assignees.nodes.map((assignee) => assignee.login),
      labels: node.labels.nodes.map((label) => label.name),
      labelIds: Object.fromEntries(node.labels.nodes.map((label) => [label.name, label.id])),
      pullRequests: node.closedByPullRequestsReferences.nodes.map((pr) => ({
        number: pr.number,
        state: pr.state,
        isDraft: pr.isDraft,
        author: author(pr.author),
      })),
      closedByMergedPr:
        node.state === 'CLOSED' && closer?.__typename === 'PullRequest' && closer.merged
          ? (author(closer.author) ?? { login: null, type: 'Unknown' })
          : null,
    },
    item: card ? { id: card.id, archived: card.isArchived, status: card.fieldValueByName?.name ?? null } : null,
  };
};

const describe = (decision, item) => {
  const parts = [];
  if (decision.add) {
    parts.push('add to the board');
  }
  if (decision.unarchive) {
    parts.push('unarchive');
  }
  if (decision.status) {
    parts.push(`status ${item?.status ?? '(none)'} -> ${decision.status}`);
  }
  if (decision.removeLabel) {
    parts.push(`remove "${TRIAGE_LABEL}"`);
  }
  if (decision.assign) {
    parts.push(`assign @${decision.assign}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'nothing to change';
};

const apply = async (gh, project, repo, number, { issue, item }, decision) => {
  let itemId = item?.id;
  if (decision.add) {
    const data = await gh.graphql(
      `mutation($project: ID!, $content: ID!) {
        addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
      }`,
      { project: project.id, content: issue.id },
    );
    itemId = data.addProjectV2ItemById.item.id;
  }
  if (decision.unarchive) {
    await gh.graphql(
      `mutation($project: ID!, $item: ID!) {
        unarchiveProjectV2Item(input: { projectId: $project, itemId: $item }) { item { id } }
      }`,
      { project: project.id, item: itemId },
    );
  }
  if (decision.status) {
    const option = project.options[decision.status];
    if (!option) {
      throw new Error(`the board has no "${decision.status}" status`);
    }
    await gh.graphql(
      `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option }
        }) { projectV2Item { id } }
      }`,
      { project: project.id, item: itemId, field: project.statusFieldId, option },
    );
  }
  if (decision.removeLabel) {
    await gh.graphql(
      `mutation($issue: ID!, $label: ID!) {
        removeLabelsFromLabelable(input: { labelableId: $issue, labelIds: [$label] }) { clientMutationId }
      }`,
      { issue: issue.id, label: issue.labelIds[TRIAGE_LABEL] },
    );
  }
  if (decision.assign) {
    // The REST endpoint ignores a login that cannot be assigned, such as a fork's author.
    await gh.rest('POST', `repos/${repo}/issues/${number}/assignees`, { assignees: [decision.assign] });
  }
};

const syncIssue = async (gh, project, repo, number, dryRun) => {
  const state = await readIssue(gh, project, repo, number);
  if (!state) {
    console.log(`${repo}#${number}: not an issue, skipped`);
    return;
  }
  const decision = decide(state.issue, state.item);
  if (decision.skip) {
    console.log(`${repo}#${number}: ${decision.skip}, skipped`);
    return;
  }
  const summary = describe(decision, state.item);
  console.log(`${repo}#${number}: ${dryRun ? '[dry run] ' : ''}${summary}`);
  if (!dryRun && summary !== 'nothing to change') {
    await apply(gh, project, repo, number, state, decision);
  }
};

const parseArgs = (argv) => {
  const args = { issues: [], prs: [], repos: [], all: false, dryRun: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) {
        throw new Error(`${flag} needs a value`);
      }
      return argv[i];
    };
    if (flag === '--project') {
      args.project = value();
    } else if (flag === '--issue') {
      args.issues.push(parseRef(value()));
    } else if (flag === '--pr') {
      args.prs.push(parseRef(value()));
    } else if (flag === '--repo') {
      args.repos.push(value());
    } else if (flag === '--all') {
      args.all = true;
    } else if (flag === '--dry-run') {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.project?.match(/^[\w.-]+\/\d+$/)) {
    throw new Error('--project <org>/<number> is required');
  }
  if (args.all && args.repos.length === 0) {
    throw new Error('--all needs at least one --repo');
  }
  return args;
};

export const readProject = async (gh, ref) => {
  const [org, number] = ref.split('/');
  const data = await gh.graphql(PROJECT_QUERY, { org, number: Number(number) });
  const project = data.organization.projectV2;
  if (!project?.field) {
    throw new Error(`Project ${ref} or its Status field is not readable with this token`);
  }
  return {
    id: project.id,
    statusFieldId: project.field.id,
    options: Object.fromEntries(project.field.options.map((option) => [option.name, option.id])),
  };
};

const targets = async (gh, project, args) => {
  const keys = new Map();
  const add = (repo, number) => keys.set(`${repo.toLowerCase()}#${number}`, { repo, number });

  for (const { repo, number } of args.issues) {
    add(repo, number);
  }
  for (const { repo, number } of args.prs) {
    const data = await gh.graphql(PR_QUERY, { ...splitRepo(repo), number });
    // An issue of another repository may be private, and this run's log may not be.
    for (const closing of data.repository.pullRequest?.closingIssuesReferences.nodes ?? []) {
      if (closing.repository.nameWithOwner.toLowerCase() === repo.toLowerCase()) {
        add(repo, closing.number);
      }
    }
    for (const previous of closingNumbers(process.env.PR_PREVIOUS_BODY, repo)) {
      add(repo, previous);
    }
  }
  if (args.all) {
    const wanted = new Map(args.repos.map((repo) => [repo.toLowerCase(), repo]));
    const items = await paginate(gh, PROJECT_ITEMS_QUERY, { id: project.id }, (data) => data.node.items);
    for (const { content } of items) {
      const repo = content?.repository && wanted.get(content.repository.nameWithOwner.toLowerCase());
      if (repo) {
        add(repo, content.number);
      }
    }
    for (const repo of args.repos) {
      const issues = await paginate(gh, OPEN_ISSUES_QUERY, splitRepo(repo), (data) => data.repository.issues);
      for (const { number } of issues) {
        add(repo, number);
      }
    }
  }
  return [...keys.values()].sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN is required');
  }
  const gh = client(token);
  const project = await readProject(gh, args.project);
  if (!project.options[STATUS.toDemo]) {
    console.log(`The board has no "${STATUS.toDemo}" status: a move there would fail.`);
  }

  let failures = 0;
  for (const { repo, number } of await targets(gh, project, args)) {
    try {
      await syncIssue(gh, project, repo, number, args.dryRun);
    } catch (error) {
      failures += 1;
      console.log(`::error::${repo}#${number}: ${error.message}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
