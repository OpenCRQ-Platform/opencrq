/**
 * Runs the inline script of `label-outside-contributions.yml` against a fake `gh`, and pins the
 * properties that keep a `pull_request_target` workflow from running a contributor's code.
 * Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = parse(
  fs.readFileSync(path.join(ROOT, '.github/workflows/label-outside-contributions.yml'), 'utf8'),
);
const JOB = WORKFLOW.jobs.label;
const SCRIPT = JOB.steps.find((step) => step.name === 'Add the ownership label').run;

// The org token is the only one the members endpoint accepts, as the real endpoint refuses the
// workflow's own token for a private member.
const FAKE_GH = `#!/bin/sh
echo "$GH_TOKEN $*" >> "$CALLS"
case "$*" in
  *"--method POST"*) exit 0 ;;
  *orgs/*/members/*)
    [ "$GH_TOKEN" = org-token ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    case "$FAKE_MEMBER" in
      yes) exit 0 ;;
      no) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
      *) echo "gh: Server Error (HTTP 500)" >&2; exit 1 ;;
    esac ;;
  *repos/*/issues/*) echo "$FAKE_OWNED" ;;
esac
`;

const runScript = (env) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'label-outside-'));
  const calls = path.join(dir, 'calls');
  fs.writeFileSync(path.join(dir, 'gh'), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(calls, '');
  try {
    const result = spawnSync('bash', ['-c', SCRIPT], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        CALLS: calls,
        GH_TOKEN: 'github-token',
        ORG_TOKEN: 'org-token',
        REPO: 'org/repo',
        ORG: 'org',
        NUMBER: '7',
        LOGIN: 'someone',
        FAKE_OWNED: '0',
        ...env,
      },
      encoding: 'utf8',
    });
    const lines = fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
    return { status: result.status, posts: lines.filter((line) => line.includes('--method POST')) };
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
};

const post = (...labels) =>
  `github-token api --method POST repos/org/repo/issues/7/labels ${labels.map((l) => `-f labels[]=${l}`).join(' ')} --silent`;

describe('label-outside-contributions script', () => {
  const cases = [
    ['member pull request', 'pull_request_target', 'yes', ['filigran team']],
    ['member issue', 'issues', 'yes', ['filigran team']],
    ['outside pull request', 'pull_request_target', 'no', ['community']],
    ['outside issue', 'issues', 'no', ['community', 'needs triage']],
  ];

  for (const [name, eventName, member, labels] of cases) {
    it(`${name} gets ${labels.join(' + ')}`, () => {
      const { status, posts } = runScript({ EVENT_NAME: eventName, FAKE_MEMBER: member });
      assert.equal(status, 0);
      assert.deepEqual(posts, [post(...labels)]);
    });
  }

  it('leaves an item that already carries an ownership label alone', () => {
    const { status, posts } = runScript({
      EVENT_NAME: 'pull_request_target',
      FAKE_MEMBER: 'no',
      FAKE_OWNED: '1',
    });
    assert.equal(status, 0);
    assert.deepEqual(posts, []);
  });

  it('labels nothing when the membership cannot be read', () => {
    const { status, posts } = runScript({ EVENT_NAME: 'issues', FAKE_MEMBER: 'error' });
    assert.notEqual(status, 0);
    assert.deepEqual(posts, []);
  });
});

describe('label-outside-contributions workflow', () => {
  it('runs on the base repository token and skips bots', () => {
    assert.deepEqual(WORKFLOW.on, {
      pull_request_target: { types: ['opened', 'reopened'] },
      issues: { types: ['opened'] },
    });
    assert.match(JOB.if, /user\.type.* != 'Bot'$/);
  });

  it('holds only the two write permissions', () => {
    assert.deepEqual(WORKFLOW.permissions, { issues: 'write', 'pull-requests': 'write' });
  });

  it('runs no code of the pull request', () => {
    const uses = JOB.steps.filter((step) => step.uses).map((step) => step.uses.split('@')[0]);
    assert.deepEqual(uses, ['actions/create-github-app-token']);
    assert.ok(JOB.steps.every((step) => !step.with?.ref));
  });

  it('gives the secret to the token mint alone, for the members permission only', () => {
    const [mint, ...others] = JOB.steps;
    assert.equal(mint.uses.split('@')[0], 'actions/create-github-app-token');
    assert.deepEqual(Object.keys(mint.with).sort(), ['client-id', 'owner', 'permission-members', 'private-key']);
    assert.equal(mint.with['permission-members'], 'read');
    assert.equal(mint.with.owner, '${{ github.repository_owner }}');
    assert.ok(others.every((step) => !JSON.stringify(step).includes('secrets.')));
  });

  it('keeps every expression out of the shell', () => {
    assert.ok(JOB.steps.every((step) => !step.run?.includes('${{')));
  });
});
