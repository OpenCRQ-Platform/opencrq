/**
 * The last steps of a release, run by CI once its image is served: the draft `/release` created on
 * the tag gets the image line and the SBOM, then is published; then Latest moves to the highest
 * published release. Releases are immutable once published, so every asset goes on before.
 */

import { highestRelease } from './lib.mjs';
import { completeNotes, sbomName } from './notes.mjs';

/**
 * The tag's release, as `{ state: 'published' | 'draft' | 'missing', release }`. Several drafts on
 * one tag throw: which one the release manager reviewed cannot be told.
 */
export const findRelease = (releases, tag) => {
  const own = releases.filter((release) => release.tag_name === tag);
  const published = own.find((release) => !release.draft);
  if (published !== undefined) {
    return { state: 'published', release: published };
  }
  if (own.length > 1) {
    throw new Error(`${own.length} draft releases on ${tag}: delete all but the one to publish`);
  }
  return own.length === 0 ? { state: 'missing', release: null } : { state: 'draft', release: own[0] };
};

/** What a tag with no draft fails with, wherever it is found missing. */
export const missingDraft = (tag) => new Error(`no draft release on ${tag}, which /release creates before pushing a tag: write its notes, create it with \`gh release create ${tag} --draft --verify-tag --notes-file <notes>\`, then re-run this job`);

/**
 * Completes and publishes the tag's draft through `github`, never as Latest, and returns what it
 * did. A tag with no draft throws; one already published is left as it is.
 */
export const publishRelease = async ({ github, tag, digest, sbom }) => {
  const releases = await github.listReleases();
  const { state, release } = findRelease(releases, tag);
  if (state === 'missing') {
    throw missingDraft(tag);
  }
  if (state === 'published') {
    return { published: false, url: release.html_url };
  }

  const name = sbomName(tag);
  for (const asset of release.assets.filter((existing) => existing.name === name)) {
    await github.deleteAsset(asset.id);
  }
  await github.uploadAsset(release, name, sbom);

  const updated = await github.updateRelease(release.id, {
    body: completeNotes({ body: release.body, tag, digest }),
    draft: false,
    make_latest: 'false',
  });
  return { published: true, url: updated.html_url };
};

/**
 * Marks Latest the highest published release, and returns its tag, or null when none is published.
 * Deciding it apart from the publication, from a list read after it, is what lets two tags publish
 * at once: whichever marks last read both, so a stale run cannot leave a lower release Latest.
 */
export const markLatest = async ({ github }) => {
  const published = (await github.listReleases()).filter((release) => !release.draft);
  const tag = highestRelease(published.map((release) => release.tag_name));
  if (tag !== null) {
    await github.updateRelease(published.find((release) => release.tag_name === tag).id, { make_latest: 'true' });
  }
  return tag;
};

/** The REST calls of the release steps, on `repo` with `token`. */
export const gitHubClient = ({ fetch, token, repo }) => {
  const call = async (method, url, { body, contentType = 'application/json' } = {}) => {
    const response = await fetch(url.startsWith('https://') ? url : `https://api.github.com/repos/${repo}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': contentType }),
      },
      body: body === undefined || typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${method} ${url}: HTTP ${response.status} ${await response.text()}`);
    }
    return response.status === 204 ? null : response.json();
  };

  return {
    listReleases: async () => {
      const all = [];
      for (let page = 1; ; page += 1) {
        const json = await call('GET', `/releases?per_page=100&page=${page}`);
        all.push(...json);
        if (json.length < 100) {
          return all;
        }
      }
    },
    deleteAsset: async (id) => {
      await call('DELETE', `/releases/assets/${id}`);
    },
    uploadAsset: async (release, name, content) => {
      const url = release.upload_url.replace(/\{.*\}$/, `?name=${encodeURIComponent(name)}`);
      await call('POST', url, { body: content, contentType: 'application/vnd.cyclonedx+json' });
    },
    updateRelease: (id, patch) => call('PATCH', `/releases/${id}`, { body: patch }),
  };
};
