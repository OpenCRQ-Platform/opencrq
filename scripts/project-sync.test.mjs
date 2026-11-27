/**
 * The rules of `.github/scripts/project-sync.mjs`, one scenario per behaviour the board promises.
 * Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { closingNumbers, decide, STATUS, TRIAGE_LABEL } from '../.github/scripts/project-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const alice = { login: 'alice', type: 'User' };
const bot = { login: 'renovate', type: 'Bot' };

const issue = (overrides = {}) => ({
  state: 'OPEN',
  assignees: ['owner'],
  labels: [],
  pullRequests: [],
  closedByMergedPr: null,
  ...overrides,
});

const pr = (overrides = {}) => ({ number: 1, state: 'OPEN', isDraft: false, author: alice, ...overrides });

const card = (status, overrides = {}) => ({ id: 'item', archived: false, status, ...overrides });

describe('project-sync rules', () => {
  it('adds an open issue missing from the board, in Inbox', () => {
    const decision = decide(issue(), null);
    assert.equal(decision.add, true);
    assert.equal(decision.status, STATUS.inbox);
  });

  it('leaves a closed issue missing from the board alone', () => {
    assert.ok(decide(issue({ state: 'CLOSED' }), null).skip);
  });

  it('puts the issue of an open draft pull request in In progress, from any planning status', () => {
    for (const status of [STATUS.inbox, STATUS.backlog, STATUS.todo]) {
      assert.equal(decide(issue({ pullRequests: [pr({ isDraft: true })] }), card(status)).status, STATUS.inProgress);
    }
  });

  it('moves it to In review once the pull request is ready, and keeps it there whatever the review says', () => {
    const ready = issue({ pullRequests: [pr()] });
    assert.equal(decide(ready, card(STATUS.inProgress)).status, STATUS.inReview);
    assert.equal(decide(ready, card(STATUS.inReview)).status, null);
  });

  it('prefers In review when one of several open pull requests is ready', () => {
    const both = issue({ pullRequests: [pr({ isDraft: true }), pr({ number: 2 })] });
    assert.equal(decide(both, card(STATUS.inProgress)).status, STATUS.inReview);
  });

  it('puts a card moved by hand to In review back in In progress while its pull request is a draft', () => {
    assert.equal(decide(issue({ pullRequests: [pr({ isDraft: true })] }), card(STATUS.inReview)).status, STATUS.inProgress);
  });

  it('sends the issue back to Todo when its last open pull request is closed unmerged', () => {
    const closed = issue({ pullRequests: [pr({ state: 'CLOSED' })] });
    assert.equal(decide(closed, card(STATUS.inReview)).status, STATUS.todo);
    assert.equal(decide(closed, card(STATUS.inProgress)).status, STATUS.todo);
  });

  it('leaves a card that a closed pull request no longer implies in its planning status', () => {
    assert.equal(decide(issue({ pullRequests: [pr({ state: 'CLOSED' })] }), card(STATUS.backlog)).status, null);
  });

  it('leaves an issue no pull request ever closed where a person put it', () => {
    assert.equal(decide(issue(), card(STATUS.inProgress)).status, null);
  });

  it('moves an issue closed by a merged pull request to To demo, not to Done', () => {
    const merged = issue({ state: 'CLOSED', closedByMergedPr: alice, pullRequests: [pr({ state: 'MERGED' })] });
    assert.equal(decide(merged, card(STATUS.inReview)).status, STATUS.toDemo);
  });

  it('keeps it in Done once a person moved it there after the demo', () => {
    const merged = issue({ state: 'CLOSED', closedByMergedPr: alice, pullRequests: [pr({ state: 'MERGED' })] });
    assert.equal(decide(merged, card(STATUS.done)).status, null);
  });

  it('moves an issue closed without a pull request to Done', () => {
    assert.equal(decide(issue({ state: 'CLOSED' }), card(STATUS.backlog)).status, STATUS.done);
  });

  it('moves an issue closed by hand to Done even when an unmerged pull request closes it', () => {
    const issueWithPr = issue({ state: 'CLOSED', pullRequests: [pr({ state: 'CLOSED' })] });
    assert.equal(decide(issueWithPr, card(STATUS.inReview)).status, STATUS.done);
  });

  it('sends a reopened issue to Todo', () => {
    assert.equal(decide(issue(), card(STATUS.done)).status, STATUS.todo);
    assert.equal(decide(issue(), card(STATUS.toDemo)).status, STATUS.todo);
  });

  it('unarchives a reopened issue, and leaves a closed archived one alone', () => {
    const reopened = decide(issue(), card(STATUS.done, { archived: true }));
    assert.equal(reopened.unarchive, true);
    assert.equal(reopened.status, STATUS.todo);
    assert.ok(decide(issue({ state: 'CLOSED' }), card(STATUS.done, { archived: true })).skip);
  });

  it('drops the triage label once the card has left Inbox, and keeps it while it is there', () => {
    const triaged = issue({ labels: [TRIAGE_LABEL] });
    assert.equal(decide(triaged, card(STATUS.backlog)).removeLabel, true);
    assert.equal(decide(triaged, card(STATUS.inbox)).removeLabel, false);
    assert.equal(decide(triaged, null).removeLabel, false);
  });

  it('assigns the author of the pull request to an issue without assignee', () => {
    assert.equal(decide(issue({ assignees: [], pullRequests: [pr({ isDraft: true })] }), card(STATUS.todo)).assign, 'alice');
  });

  it('keeps an existing assignee', () => {
    assert.equal(decide(issue({ pullRequests: [pr()] }), card(STATUS.todo)).assign, null);
  });

  it('assigns no bot', () => {
    assert.equal(decide(issue({ assignees: [], pullRequests: [pr({ author: bot })] }), card(STATUS.todo)).assign, null);
  });

  it('assigns the author of the merged pull request to an issue waiting for its demo without assignee', () => {
    const merged = issue({ state: 'CLOSED', assignees: [], closedByMergedPr: alice });
    assert.equal(decide(merged, card(STATUS.inReview)).assign, 'alice');
    assert.equal(decide(merged, card(STATUS.done)).assign, null);
  });

  it('changes nothing on a card already where its pull request says', () => {
    assert.deepEqual(decide(issue({ pullRequests: [pr({ isDraft: true })] }), card(STATUS.inProgress)), {
      add: false,
      unarchive: false,
      status: null,
      removeLabel: false,
      assign: null,
    });
  });
});

describe('closingNumbers', () => {
  it('reads the issues of the repository a body closes with a keyword', () => {
    const body = 'Closes #12, fixes: #13 and Resolved org/repo#14.\nRefs #15, closes other/repo#16';
    assert.deepEqual(closingNumbers(body, 'org/repo'), [12, 13, 14]);
  });

  it('reads nothing from an absent body', () => {
    assert.deepEqual(closingNumbers(undefined, 'org/repo'), []);
  });
});

describe('project-sync workflow', () => {
  const source = fs.readFileSync(path.join(ROOT, '.github/workflows/project-sync.yml'), 'utf8');
  const workflow = parse(source);
  const job = workflow.jobs.sync;

  it('never runs in the base repository context of a fork pull request', () => {
    assert.ok(!('pull_request_target' in workflow.on));
    assert.match(job.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  });

  it('runs the default branch script, not the pull request version', () => {
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}');
  });

  it('reads only the code, with the workflow token', () => {
    assert.deepEqual(workflow.permissions, {});
    assert.deepEqual(job.permissions, { contents: 'read' });
  });

  it('skips while the App is not configured', () => {
    assert.match(job.if, /vars\.PROJECT_SYNC_CLIENT_ID != ''/);
  });
});
