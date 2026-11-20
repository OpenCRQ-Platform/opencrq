/**
 * The release number to tag next, the version an image build carries, and the steps of a release.
 *
 * Usage:
 *   node scripts/release.mjs                            print the next release number, from the tags
 *                                                       on origin
 *   node scripts/release.mjs build-version <ref> <sha>  print the APP_VERSION of an image built from
 *                                                       <ref> at <sha> (the image build runs this)
 *   node scripts/release.mjs prepare <commit> <notes>
 *                                                       check a commit can be released, write its
 *                                                       draft notes to <notes> and print what the
 *                                                       release is, as JSON (`/release` runs this)
 *   node scripts/release.mjs wait-image <tag> <sha>     wait until Docker Hub serves the tag's image,
 *                                                       built from <sha>, and print its digest (CI)
 *   node scripts/release.mjs find <tag>                 print whether the tag's release is a draft or
 *                                                       already published, and fail when it has none,
 *                                                       with GITHUB_TOKEN on GITHUB_REPOSITORY (CI)
 *   node scripts/release.mjs publish <tag> <digest> <sbom>
 *                                                       complete the tag's draft release and publish
 *                                                       it, with GITHUB_TOKEN on GITHUB_REPOSITORY (CI)
 *   node scripts/release.mjs mark-latest                mark Latest the highest published release,
 *                                                       with GITHUB_TOKEN on GITHUB_REPOSITORY (CI)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildVersion, MAJOR, nextReleaseNumber, tagNames } from './release/lib.mjs';
import { draftNotes, IMAGE } from './release/notes.mjs';
import { prepareRelease } from './release/prepare.mjs';
import { findRelease, gitHubClient, markLatest, missingDraft, publishRelease } from './release/publish.mjs';
import { waitForImage } from './release/registry.mjs';

// The release repository's build of an image takes about 15 minutes: three times that rides out a
// slow Docker Hub or a queued runner, and beyond it the build has failed.
const IMAGE_WAIT_MS = 45 * 60 * 1000;
const IMAGE_POLL_MS = 30 * 1000;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const gitOk = (...args) => spawnSync('git', args, { stdio: 'ignore' }).status === 0;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const env = (variable) => {
  const value = process.env[variable];
  if (!value) {
    throw new Error(`${variable} is not set`);
  }
  return value;
};

const github = () => gitHubClient({ fetch, token: env('GITHUB_TOKEN'), repo: env('GITHUB_REPOSITORY') });

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'build-version') {
    const [ref, sha] = args;
    const commitDate = (commit) => new Date(git('show', '-s', '--format=%cI', '--end-of-options', commit).trim());
    process.stdout.write(`${buildVersion({ ref: ref ?? '', sha: sha ?? '', commitDate, today: new Date() })}\n`);
  } else if (command === undefined) {
    const tags = tagNames(git('ls-remote', '--tags', 'origin'));
    process.stdout.write(`${nextReleaseNumber({ major: MAJOR, date: new Date(), tags })}\n`);
  } else if (command === 'prepare' && args.length === 2) {
    const [input, notes] = args;
    const { changelog, ...release } = prepareRelease({ git, gitOk, gh, input, today: new Date() });
    writeFileSync(notes, `${draftNotes({ changelog })}\n`);
    process.stdout.write(`${JSON.stringify({ ...release, notes }, null, 2)}\n`);
  } else if (command === 'wait-image' && args.length === 2) {
    const [tag, sha] = args;
    const digest = await waitForImage({
      fetch, image: IMAGE, tag, sha, timeoutMs: IMAGE_WAIT_MS, intervalMs: IMAGE_POLL_MS, sleep, now: Date.now,
      log: (message) => process.stderr.write(`${message}\n`),
    });
    process.stdout.write(`${digest}\n`);
  } else if (command === 'find' && args.length === 1) {
    const [tag] = args;
    const { state, release } = findRelease(await github().listReleases(), tag);
    if (state === 'missing') {
      throw missingDraft(tag);
    }
    process.stderr.write(state === 'published' ? `${release.html_url} is already published: left as it is\n` : `Draft found: ${release.html_url}\n`);
    process.stdout.write(`${state}\n`);
  } else if (command === 'publish' && args.length === 3) {
    const [tag, digest, sbom] = args;
    const outcome = await publishRelease({ github: github(), tag, digest, sbom: readFileSync(sbom) });
    process.stdout.write(outcome.published ? `Published ${outcome.url}\n` : `${outcome.url} is already published: left as it is\n`);
  } else if (command === 'mark-latest' && args.length === 0) {
    const tag = await markLatest({ github: github() });
    process.stdout.write(tag === null ? 'No published release\n' : `Latest: ${tag}\n`);
  } else {
    throw new Error(`unknown command "${[command, ...args].join(' ')}"`);
  }
} catch (error) {
  process.stderr.write(`release: ${error.message}\n`);
  process.exit(1);
}
