/**
 * The release number's rules, the version an image build carries, and the steps of a release.
 * Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { parseTitle, releasedIssues, renderChangelog, sectionOf } from './release/changelog.mjs';
import { buildVersion, compareReleases, highestRelease, nextReleaseNumber, tagNames } from './release/lib.mjs';
import { completeNotes, draftNotes, HIGHLIGHTS_PLACEHOLDER } from './release/notes.mjs';
import { markLatest, publishRelease } from './release/publish.mjs';
import { prepareRelease } from './release/prepare.mjs';
import { waitForImage } from './release/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOV_30 = new Date('2026-11-30T23:59:59Z');

describe('the next release number', () => {
  it('is the day in UTC with z = 0 for its first release', () => {
    assert.equal(nextReleaseNumber({ major: 0, date: NOV_30, tags: ['0.261129.0', '0.261129.1'] }), '0.261130.0');
  });

  it('is one past the highest z of the day, whatever the gaps', () => {
    assert.equal(nextReleaseNumber({ major: 0, date: NOV_30, tags: ['0.261130.0', '0.261130.3'] }), '0.261130.4');
  });

  it('counts the day under its own major only, and ignores other tags', () => {
    const tags = ['1.261130.5', 'v0.261130.7', '0.261130.2-lts.1', 'main-0123abcd'];
    assert.equal(nextReleaseNumber({ major: 0, date: NOV_30, tags }), '0.261130.0');
  });

  it('pads the month and the day', () => {
    assert.equal(nextReleaseNumber({ major: 0, date: new Date('2027-01-05T00:00:00Z'), tags: [] }), '0.270105.0');
  });
});

describe('the tags on origin', () => {
  it('are read from git ls-remote, annotated or not', () => {
    const lsRemote = 'aaa\trefs/tags/0.261130.0\nbbb\trefs/tags/0.261130.1\nccc\trefs/tags/0.261130.1^{}\n';
    assert.deepEqual(tagNames(lsRemote), ['0.261130.0', '0.261130.1', '0.261130.1']);
  });
});

describe('the version of an image', () => {
  const SHA = '0fed327c0ffee0123456789abcdef0123456789a';
  const commitDate = () => NOV_30;
  const today = new Date('2026-12-02T12:00:00Z');

  it('is the tag it is built from, when that tag is a release', () => {
    assert.equal(buildVersion({ ref: 'refs/tags/0.261130.2', sha: SHA, commitDate, today }), '0.261130.2');
  });

  it('fails on a tag CI builds as a release that is not one', () => {
    for (const tag of ['1.261130.0', '0.2611300.0', '99.99999999.0', '0.1.2']) {
      assert.throws(() => buildVersion({ ref: `refs/tags/${tag}`, sha: SHA, commitDate, today }), /is not a release/, tag);
    }
  });

  it('may be dated from the day of its commit to the day it is built, and only on a real day', () => {
    assert.equal(buildVersion({ ref: 'refs/tags/0.261202.0', sha: SHA, commitDate, today }), '0.261202.0');
    for (const tag of ['0.261129.0', '0.261203.0', '0.621130.0', '0.261311.0', '0.261131.0', '0.260230.0']) {
      assert.throws(() => buildVersion({ ref: `refs/tags/${tag}`, sha: SHA, commitDate, today }), /is not dated on a day between/, tag);
    }
  });

  it('is a development version of the commit day in UTC and the commit, from any other ref', () => {
    for (const ref of ['refs/heads/main', 'refs/pull/42/merge', 'refs/heads/3102-x', 'refs/tags/v0.261130.2']) {
      assert.equal(buildVersion({ ref, sha: SHA, commitDate, today }), '0.261130.0-dev.0fed327', ref);
    }
  });

  it('stays under the 50 characters XTM One stores', () => {
    assert.ok(buildVersion({ ref: 'refs/heads/main', sha: SHA, commitDate, today }).length <= 50);
  });

  it('refuses a commit that is not a sha', () => {
    assert.throws(() => buildVersion({ ref: 'refs/heads/main', sha: '', commitDate, today }));
  });

  it('is what the image build prints, dated by the commit rather than the build', () => {
    const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } }).stdout.trim();
    const head = git('rev-parse', 'HEAD');
    const day = git('show', '-s', '--format=%cd', '--date=format-local:%y%m%d', head);
    const run = (...args) => spawnSync(process.execPath, ['scripts/release.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run('build-version', `refs/tags/0.${day}.2`, head).stdout, `0.${day}.2\n`);
    assert.equal(run('build-version', 'refs/heads/main', head).stdout, `0.${day}.0-dev.${head.slice(0, 7)}\n`);
    assert.equal(run('build-version', 'refs/heads/main', '').status, 1);
    assert.equal(run('build-version', 'refs/tags/1.2.3', head).status, 1);
  });
});

describe('the order of releases', () => {
  it('compares each part as a number', () => {
    assert.ok(compareReleases('0.261130.10', '0.261130.9') > 0);
    assert.ok(compareReleases('0.261201.0', '0.261130.9') > 0);
    assert.equal(compareReleases('0.261130.1', '0.261130.1'), 0);
  });

  it('finds the highest release, leaving out the one being cut and any other tag', () => {
    assert.equal(highestRelease(['0.261116.0', '0.261120.1', '0.261120.0', 'v9.0.0', ''], '0.261120.1'), '0.261120.0');
    assert.equal(highestRelease(['v1', 'main']), null);
  });
});

const issue = (number, title, { type = null, labels = [], state = 'CLOSED', closer = { pullRequest: 900 + number, commit: null } } = {}) => ({
  number, title, type, labels, state, closer,
});

describe('the changelog', () => {
  it('reads a title without its Conventional Commits prefix or its reference', () => {
    assert.deepEqual(parseTitle('feat(crq)!: drop the v1 export (#12)'), { type: 'feat', breaking: true, description: 'drop the v1 export' });
    assert.deepEqual(parseTitle('Plain title'), { type: null, breaking: false, description: 'Plain title' });
  });

  it('puts a breaking change first, then security, then the Type', () => {
    assert.equal(sectionOf(issue(1, 'fix!: x', { type: 'Bug', labels: ['security'] })), 'breaking');
    assert.equal(sectionOf(issue(6, 'fix: x', { type: 'Bug', labels: ['breaking-change', 'security'] })), 'breaking');
    assert.equal(sectionOf(issue(2, 'fix: x', { type: 'Bug', labels: ['security'] })), 'security');
    assert.equal(sectionOf(issue(3, 'chore: x', { type: 'Feature' })), 'enhancements');
    assert.equal(sectionOf(issue(4, 'feat: x', { type: 'Bug' })), 'fixes');
    assert.equal(sectionOf(issue(5, 'feat: x', { type: 'Task' })), 'maintenance');
  });

  it('falls back on the label, then on the title, for an issue without a Type', () => {
    assert.equal(sectionOf(issue(1, 'chore: x', { labels: ['feature'] })), 'enhancements');
    assert.equal(sectionOf(issue(2, 'chore: x', { labels: ['bug'] })), 'fixes');
    assert.equal(sectionOf(issue(3, 'feat: x')), 'enhancements');
    assert.equal(sectionOf(issue(4, 'fix(ui): x')), 'fixes');
    assert.equal(sectionOf(issue(5, 'docs: x')), 'maintenance');
    assert.equal(sectionOf(issue(6, 'no prefix')), 'maintenance');
  });

  it('holds the issues the range closed, and none closed by hand, reopened or closed elsewhere', () => {
    const issues = [
      issue(1, 'feat: by a pull request of the range', { closer: { pullRequest: 10, commit: null } }),
      issue(2, 'feat: by a commit of the range', { closer: { pullRequest: null, commit: 'abc' } }),
      issue(3, 'feat: by hand', { closer: null }),
      issue(4, 'feat: reopened', { state: 'OPEN', closer: { pullRequest: 10, commit: null } }),
      issue(5, 'feat: by a later chunk', { closer: { pullRequest: 11, commit: null } }),
    ];
    const held = releasedIssues({ issues, pullRequests: new Set([10]), commits: new Set(['abc']) });
    assert.deepEqual(held.map(({ number }) => number), [1, 2]);
  });

  it('renders the sections in order, Maintenance collapsed, Enterprise Edition marked, then the compare link', () => {
    const changelog = renderChangelog({
      compareUrl: 'https://github.com/o/r/compare/0.1.0...0.2.0',
      issues: [
        issue(9, 'chore: bump a tool', { type: 'Task' }),
        issue(4, 'fix: a crash', { type: 'Bug' }),
        issue(3, 'feat: a page', { type: 'Feature', labels: ['enterprise edition'] }),
        issue(2, 'feat!: remove an endpoint', { type: 'Feature' }),
      ],
    });
    assert.equal(changelog, [
      '### Breaking changes\n\n- Remove an endpoint (#2)',
      '### Enhancements\n\n- A page (#3) · *Enterprise Edition*',
      '### Bug fixes\n\n- A crash (#4)',
      '<details>\n<summary><strong>Maintenance</strong> (1)</summary>\n\n- Bump a tool (#9)\n\n</details>',
      '**Full changelog**: https://github.com/o/r/compare/0.1.0...0.2.0',
    ].join('\n\n'));
  });

  it('says so when no issue was closed', () => {
    assert.match(renderChangelog({ issues: [], compareUrl: 'u' }), /^No issue was closed in this release\.\n\n\*\*Full changelog\*\*: u$/);
  });
});

describe('the release notes', () => {
  it('have no changelog on the first release', () => {
    assert.equal(draftNotes({ changelog: null }), `## Highlights\n\n${HIGHLIGHTS_PLACEHOLDER}`);
    assert.match(draftNotes({ changelog: 'X' }), /## Highlights[\s\S]*## Changelog\n\nX$/);
  });

  it('end with the image and the files, once, however many times CI completes them', () => {
    const once = completeNotes({ body: '## Highlights\n\nNew.\n', tag: '0.261120.0', digest: 'sha256:aa' });
    assert.match(once, /^## Highlights\n\nNew\.\n\n/);
    assert.match(once, /docker pull filigran\/opencrq:0\.261120\.0/);
    assert.match(once, /Digest: `sha256:aa`/);
    assert.match(once, /`sbom-opencrq-0\.261120\.0\.cdx\.json`/);
    assert.equal(completeNotes({ body: once, tag: '0.261120.0', digest: 'sha256:aa' }), once);
    assert.match(completeNotes({ body: once, tag: '0.261120.0', digest: 'sha256:bb' }), /sha256:bb/);
    assert.doesNotMatch(completeNotes({ body: once, tag: '0.261120.0', digest: 'sha256:bb' }), /sha256:aa/);
  });
});

/** A Docker Hub answering from `state()`: null while the tag is missing, else its revision label. */
const fakeHub = ({ state, index = false, failures = 0 }) => {
  let failing = failures;
  return async (url, { method = 'GET' } = {}) => {
    const json = (body) => ({ ok: true, status: 200, headers: new Map(), json: async () => body });
    if (url.startsWith('https://auth.docker.io/')) {
      if (failing > 0) {
        failing -= 1;
        return { ok: false, status: 503 };
      }
      return json({ token: 't' });
    }
    if (url.endsWith('/manifests/0.261120.0') && method === 'HEAD') {
      return state() === null
        ? { ok: false, status: 404, headers: new Map() }
        : { ok: true, status: 200, headers: new Map([['docker-content-digest', index ? 'sha256:index' : 'sha256:manifest']]) };
    }
    if (url.endsWith('/manifests/sha256:index')) {
      return json({
        mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: [
          { digest: 'sha256:arm', platform: { os: 'linux', architecture: 'arm64' } },
          { digest: 'sha256:manifest', platform: { os: 'linux', architecture: 'amd64' } },
        ],
      });
    }
    if (url.endsWith('/manifests/sha256:manifest')) {
      return json({ mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: 'sha256:config' } });
    }
    if (url.endsWith('/blobs/sha256:config')) {
      return json({ config: { Labels: { 'org.opencontainers.image.revision': state() } } });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
};

describe('the wait for the image', () => {
  const SHA = 'a185f011769ea1e5986a23e2eb85dab9b94d0635';
  const clock = () => {
    let time = 0;
    const sleep = async (ms) => {
      time += ms;
    };
    return { now: () => time, sleep };
  };
  const wait = (fetch, c, logs = []) => waitForImage({
    fetch, image: 'filigran/opencrq', tag: '0.261120.0', sha: SHA, timeoutMs: 10_000, intervalMs: 1_000, ...c, log: (m) => logs.push(m),
  });

  it('resolves to the digest once the tag is served, built from the commit', async () => {
    const c = clock();
    const fetch = fakeHub({ state: () => (c.now() < 3_000 ? null : SHA) });
    assert.equal(await wait(fetch, c), 'sha256:manifest');
    assert.equal(c.now(), 3_000);
  });

  it('reads the linux/amd64 image of an index, and keeps the index digest', async () => {
    assert.equal(await wait(fakeHub({ state: () => SHA, index: true }), clock()), 'sha256:index');
  });

  it('rides out registry errors', async () => {
    const logs = [];
    assert.equal(await wait(fakeHub({ state: () => SHA, failures: 2 }), clock(), logs), 'sha256:manifest');
    assert.equal(logs.length, 1);
  });

  it('fails once the bound has passed, naming an image built from another commit', async () => {
    await assert.rejects(wait(fakeHub({ state: () => 'other' }), clock()), /was not served after .*built from other/);
    await assert.rejects(wait(fakeHub({ state: () => null }), clock()), /not found/);
  });
});

describe('the publication', () => {
  const release = (id, tag, draft, extra = {}) => ({
    id, tag_name: tag, draft, body: '## Highlights\n\nNew.', html_url: `https://x/${id}`,
    upload_url: `https://uploads.github.com/repos/o/r/releases/${id}/assets{?name,label}`, assets: [], ...extra,
  });
  const fakeGitHub = (releases) => {
    const calls = [];
    return {
      calls,
      listReleases: async () => releases,
      deleteAsset: async (id) => calls.push(['delete', id]),
      uploadAsset: async (r, name) => calls.push(['upload', r.id, name]),
      updateRelease: async (id, patch) => {
        calls.push(['update', id, patch]);
        return { html_url: `https://x/${id}` };
      },
    };
  };
  const publish = (github, tag = '0.261120.0') => publishRelease({ github, tag, digest: 'sha256:aa', sbom: Buffer.from('{}') });

  it('fails on a tag with no draft, and on one with several', async () => {
    await assert.rejects(publish(fakeGitHub([release(1, '0.261116.0', false)])), /no draft release on 0\.261120\.0/);
    await assert.rejects(publish(fakeGitHub([release(1, '0.261120.0', true), release(2, '0.261120.0', true)])), /2 draft releases/);
  });

  it('leaves a published release as it is', async () => {
    const github = fakeGitHub([release(1, '0.261120.0', false), release(2, '0.261120.0', true)]);
    assert.deepEqual(await publish(github), { published: false, url: 'https://x/1' });
    assert.deepEqual(github.calls, []);
  });

  it('attaches the SBOM in place of any earlier one, then publishes with the completed notes', async () => {
    const github = fakeGitHub([
      release(1, '0.261116.0', false),
      release(2, '0.261120.0', true, { assets: [{ id: 7, name: 'sbom-opencrq-0.261120.0.cdx.json' }, { id: 8, name: 'other' }] }),
    ]);
    assert.deepEqual(await publish(github), { published: true, url: 'https://x/2' });
    assert.deepEqual(github.calls.slice(0, 2), [['delete', 7], ['upload', 2, 'sbom-opencrq-0.261120.0.cdx.json']]);
    const [, id, patch] = github.calls[2];
    assert.equal(id, 2);
    assert.equal(patch.draft, false);
    assert.equal(patch.make_latest, 'false');
    assert.match(patch.body, /^## Highlights\n\nNew\.\n\n[\s\S]*docker pull filigran\/opencrq:0\.261120\.0/);
  });

  it('marks latest the highest published release, whatever the drafts and the order of publication', async () => {
    const github = fakeGitHub([release(1, '0.261121.0', false), release(2, '0.261120.0', false), release(3, '0.261122.0', true)]);
    assert.equal(await markLatest({ github }), '0.261121.0');
    assert.deepEqual(github.calls, [['update', 1, { make_latest: 'true' }]]);
  });

  it('marks nothing when no release is published', async () => {
    const github = fakeGitHub([release(1, '0.261121.0', true)]);
    assert.equal(await markLatest({ github }), null);
    assert.deepEqual(github.calls, []);
  });
});

describe('the release job of CI', () => {
  const ci = parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  const job = ci.jobs.release;

  it('runs on a pushed release tag of this repository only, after the hand-over and the SBOM', () => {
    assert.deepEqual(job.needs, ['hand-over', 'wf-sbom']);
    assert.match(job.if, /github\.event_name == 'push'/);
    assert.match(job.if, /startsWith\(github\.ref, 'refs\/tags\/'\)/);
    assert.match(job.if, /github\.repository == 'OpenCRQ-Platform\/opencrq'/);
  });

  it('may write contents and nothing else, with no secret but its own token', () => {
    assert.deepEqual(job.permissions, { contents: 'write' });
    assert.equal(job.environment, undefined);
    assert.doesNotMatch(JSON.stringify(job), /secrets\./);
  });

  it('fails the publication step on a failed publication, despite its tee', () => {
    const step = job.steps.find((candidate) => candidate.name === 'Publish the release');
    assert.equal(step.shell, 'bash');
  });

  it('marks latest one run at a time, after the publication, never canceling a running one', () => {
    const latest = ci.jobs['release-latest'];
    assert.equal(latest.needs, 'release');
    assert.equal(latest.if, job.if);
    assert.deepEqual(latest.concurrency, { group: 'github-release-latest', 'cancel-in-progress': false });
    assert.deepEqual(latest.permissions, { contents: 'write' });
  });

  it('looks for the draft only once the image is served, and builds the SBOM only for a draft', () => {
    const names = job.steps.map((step) => step.name ?? step.uses);
    assert.ok(names.indexOf('Wait for the image on Docker Hub') < names.indexOf('Find the draft release'));
    const after = job.steps.slice(names.indexOf('Find the draft release') + 1);
    assert.ok(after.length > 0 && after.every((step) => step.if === "steps.draft.outputs.state == 'draft'"));
  });
});

describe('the preparation of a release', () => {
  const SHA = 'b'.repeat(40);
  const COMMITS = ['c1'.padEnd(40, '1'), 'c2'.padEnd(40, '2')];
  const TODAY = new Date('2026-11-20T10:00:00Z');

  /**
   * A git and a gh answering for `SHA` on OpenCRQ-Platform/opencrq, as `over` alters it; `calls`
   * records the gh calls.
   */
  const fakes = (over = {}) => {
    const state = {
      onMain: true,
      containedIn: [],
      remoteTags: ['0.261116.0', '0.261120.0'],
      mergedTags: ['0.261116.0', 'v-old'],
      runs: [{ run_number: 7, id: 70, status: 'completed', conclusion: 'success', html_url: 'https://ci/70' }],
      jobs: [{ name: 'App test', conclusion: 'success' }, { name: 'Hand over to the release repository', conclusion: 'success' }],
      releases: [],
      pulls: {
        [COMMITS[0]]: [{ number: 50, mergeCommit: { oid: COMMITS[0] }, issues: [[10, 'OpenCRQ-Platform/opencrq'], [11, 'Other/repo']] }],
        [COMMITS[1]]: [
          { number: 51, mergeCommit: { oid: COMMITS[1] }, issues: [[12, 'OpenCRQ-Platform/opencrq'], [13, 'OpenCRQ-Platform/opencrq']] },
          // Holds a commit of the range, merged after it.
          { number: 52, mergeCommit: { oid: 'f'.repeat(40) }, issues: [[14, 'OpenCRQ-Platform/opencrq']] },
        ],
      },
      // #11 is this repository's own #11, which another repository's #11 must not bring in.
      issues: {
        10: { title: 'feat!: drop the v1 export', type: 'Feature', closer: { number: 50 } },
        11: { title: 'feat: an unrelated issue', type: 'Feature', closer: { number: 50 } },
        12: { title: 'fix: a crash', type: 'Bug', closer: { number: 51 } },
        13: { title: 'feat: closed by hand', type: 'Feature', closer: null },
        14: { title: 'feat: merged in the next release', type: 'Feature', closer: { number: 52 } },
      },
      ...over,
    };
    const calls = [];
    const git = (...args) => {
      const command = args.join(' ');
      if (command.startsWith('fetch')) {
        return '';
      }
      if (command.startsWith('rev-parse --verify')) {
        return `${SHA}\n`;
      }
      if (command === `tag --contains ${SHA}`) {
        return state.containedIn.join('\n');
      }
      if (command === 'ls-remote --tags origin') {
        return state.remoteTags.map((tag) => `x\trefs/tags/${tag}`).join('\n');
      }
      if (command === `tag --merged ${SHA}`) {
        return state.mergedTags.join('\n');
      }
      if (command === `rev-list --first-parent 0.261116.0..${SHA}`) {
        return COMMITS.join('\n');
      }
      throw new Error(`unexpected git ${command}`);
    };
    const gitOk = (...args) => {
      const command = args.join(' ');
      if (command === `merge-base --is-ancestor ${SHA} origin/main`) {
        return state.onMain;
      }
      throw new Error(`unexpected git ${command}`);
    };
    const gh = (...args) => {
      calls.push(args);
      const [first, second] = args;
      if (first === 'repo') {
        return 'OpenCRQ-Platform/opencrq\n';
      }
      if (second.includes('/actions/workflows/ci.yml/runs?')) {
        return JSON.stringify({ workflow_runs: state.runs });
      }
      if (second.endsWith('/actions/runs/70/jobs?per_page=100')) {
        return JSON.stringify({ jobs: state.jobs });
      }
      if (second === '--paginate') {
        return JSON.stringify([state.releases]);
      }
      if (second === 'graphql') {
        const query = args[3];
        const data = {};
        if (query.includes('associatedPullRequests')) {
          [...query.matchAll(/(c\d+): object\(oid: "([0-9a-f]+)"\)/g)].forEach(([, alias, oid]) => {
            data[alias] = { oid, associatedPullRequests: { nodes: (state.pulls[oid] ?? []).map(({ issues, ...pull }) => ({
              ...pull, closingIssuesReferences: { nodes: issues.map(([number, nameWithOwner]) => ({ number, repository: { nameWithOwner } })) },
            })) } };
          });
        } else {
          [...query.matchAll(/(i(\d+)): issue\(number: \d+\)/g)].forEach(([, alias, number]) => {
            const found = state.issues[number];
            data[alias] = found === undefined ? null : {
              number: Number(number), title: found.title, state: 'CLOSED', issueType: { name: found.type }, labels: { nodes: [] },
              timelineItems: { nodes: [{ closer: found.closer }] },
            };
          });
        }
        return JSON.stringify({ data: { repository: data } });
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    };
    return { git, gitOk, gh, calls };
  };
  const prepare = (input, over) => prepareRelease({ ...fakes(over), input, today: TODAY });

  it('refuses a commit that is not on main', () => {
    assert.throws(() => prepare(SHA, { onMain: false }), /is not on main/);
  });

  it('refuses a commit that a release already holds, its own or a later one', () => {
    assert.throws(() => prepare(SHA, { containedIn: ['0.261118.0', 'other'] }), /is already in 0\.261118\.0: release a commit after it/);
  });

  it('refuses a commit whose CI run on main is missing, not finished or not green', () => {
    assert.throws(() => prepare(SHA, { runs: [] }), /has no CI run on main/);
    assert.throws(() => prepare(SHA, { runs: [{ run_number: 1, id: 70, status: 'in_progress', conclusion: null, html_url: 'u' }] }), /is in_progress/);
    const runs = [
      { run_number: 8, id: 80, status: 'completed', conclusion: 'failure', html_url: 'u' },
      { run_number: 7, id: 70, status: 'completed', conclusion: 'success', html_url: 'u' },
    ];
    assert.throws(() => prepare(SHA, { runs }), /is failure/);
  });

  it('refuses a commit whose hand-over did not succeed', () => {
    assert.throws(() => prepare(SHA, { jobs: [{ name: 'App test', conclusion: 'success' }] }), /"Hand over to the release repository" is missing/);
    assert.throws(() => prepare(SHA, { jobs: [{ name: 'Hand over to the release repository', conclusion: 'skipped' }] }), /is skipped/);
  });

  it('gathers the next version, the previous release and the issues the range closed', () => {
    const release = prepare(SHA);
    assert.equal(release.version, '0.261120.1');
    assert.equal(release.previousTag, '0.261116.0');
    assert.equal(release.ciRun, 'https://ci/70');
    assert.equal(release.issues, 2);
    assert.match(release.changelog, /### Breaking changes\n\n- Drop the v1 export \(#10\)/);
    assert.match(release.changelog, /### Bug fixes\n\n- A crash \(#12\)/);
    assert.doesNotMatch(release.changelog, /#1[134]\b/);
    assert.match(release.changelog, /compare\/0\.261116\.0\.\.\.0\.261120\.1$/);
  });

  it('has no changelog for the first release, and asks GitHub for no pull request', () => {
    const { calls, ...over } = fakes({ mergedTags: ['v-old'] });
    const release = prepareRelease({ ...over, input: SHA, today: TODAY });
    assert.equal(release.previousTag, null);
    assert.equal(release.changelog, null);
    assert.ok(calls.every((args) => args[1] !== 'graphql'));
  });

  it('refuses the next number when a draft whose tag never came already holds it', () => {
    const releases = [{ tag_name: '0.261120.1', draft: true, html_url: 'https://x/9' }];
    assert.throws(() => prepare(SHA, { releases }), /0\.261120\.1 already has a draft release, with no tag on origin: https:\/\/x\/9/);
  });
});
