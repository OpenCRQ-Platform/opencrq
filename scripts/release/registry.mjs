/**
 * Whether Docker Hub serves a release's image, read anonymously, as any user would pull it.
 */

const AUTH = 'https://auth.docker.io/token';
const REGISTRY = 'https://registry-1.docker.io/v2';
const REVISION = 'org.opencontainers.image.revision';

const INDEXES = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'];
const MANIFESTS = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];
const ACCEPT = [...INDEXES, ...MANIFESTS].join(', ');

const ok = async (response, what) => {
  if (!response.ok) {
    throw new Error(`${what}: HTTP ${response.status}`);
  }
  return response;
};

/**
 * The digest `image:tag` is served under and the commit its revision label names, or null while
 * the tag is not there. Polled with HEAD, which Docker Hub does not count as a pull, so that a long
 * wait does not spend the anonymous pull quota of a shared runner.
 */
export const readImage = async ({ fetch, image, tag }) => {
  const { token } = await (await ok(await fetch(`${AUTH}?service=registry.docker.io&scope=repository:${image}:pull`), 'Docker Hub token')).json();
  const headers = { Authorization: `Bearer ${token}`, Accept: ACCEPT };
  const manifestUrl = (reference) => `${REGISTRY}/${image}/manifests/${reference}`;

  const head = await fetch(manifestUrl(tag), { method: 'HEAD', headers });
  if (head.status === 404) {
    return null;
  }
  await ok(head, `${image}:${tag}`);
  const digest = head.headers.get('docker-content-digest');
  if (!digest) {
    throw new Error(`${image}:${tag}: no digest in the registry's answer`);
  }

  let manifest = await (await ok(await fetch(manifestUrl(digest), { headers }), `${image}@${digest}`)).json();
  if (INDEXES.includes(manifest.mediaType)) {
    const amd64 = manifest.manifests.find(({ platform }) => platform?.os === 'linux' && platform?.architecture === 'amd64');
    if (amd64 === undefined) {
      throw new Error(`${image}@${digest} has no linux/amd64 image`);
    }
    manifest = await (await ok(await fetch(manifestUrl(amd64.digest), { headers }), `${image}@${amd64.digest}`)).json();
  }
  const config = await (await ok(await fetch(`${REGISTRY}/${image}/blobs/${manifest.config.digest}`, { headers }), `${image} config`)).json();
  return { digest, revision: config.config?.Labels?.[REVISION] ?? null };
};

/**
 * Waits until Docker Hub serves `image:tag` built from commit `sha`, and resolves to its digest;
 * rejects once `timeoutMs` has passed. A registry error is retried like a missing tag: a slow or
 * flaky Docker Hub only delays the release.
 */
export const waitForImage = async ({ fetch, image, tag, sha, timeoutMs, intervalMs, sleep, now, log }) => {
  const deadline = now() + timeoutMs;
  let last = null;
  for (;;) {
    try {
      const found = await readImage({ fetch, image, tag });
      if (found !== null && found.revision === sha) {
        return found.digest;
      }
      const seen = found === null ? 'not found' : `built from ${found.revision ?? 'an unlabelled commit'}, not ${sha}`;
      if (seen !== last) {
        log(`${image}:${tag}: ${seen}, waiting`);
      }
      last = seen;
    } catch (error) {
      if (error.message !== last) {
        log(`${image}:${tag}: ${error.message}, retrying`);
      }
      last = error.message;
    }
    if (now() + intervalMs > deadline) {
      throw new Error(`${image}:${tag} was not served after ${Math.round(timeoutMs / 60000)} minutes (${last})`);
    }
    await sleep(intervalMs);
  }
};
