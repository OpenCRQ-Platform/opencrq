/**
 * The notes of a release: the highlights and the changelog, which `/release` drafts and a release
 * manager reviews, then the image and the files, which CI appends once the image is published.
 */

export const IMAGE = 'filigran/opencrq';

export const HIGHLIGHTS_PLACEHOLDER = '<!-- highlights: what changes for a user, and what an upgrade needs -->';

// What CI appends starts here, so that a re-run replaces it rather than appending it twice.
const CI_MARKER = '<!-- published by CI -->';

export const sbomName = (tag) => `sbom-opencrq-${tag}.cdx.json`;

/** The draft `/release` writes: a placeholder for the highlights, then the changelog when there is one. */
export const draftNotes = ({ changelog }) => [
  '## Highlights',
  HIGHLIGHTS_PLACEHOLDER,
  ...(changelog === null ? [] : ['## Changelog', changelog]),
].join('\n\n');

/** `body` with the image line and the files, in place of any CI already appended. */
export const completeNotes = ({ body, tag, digest }) => {
  const own = (body ?? '').split(CI_MARKER)[0].trimEnd();
  const blocks = [
    ...(own === '' ? [] : [own]),
    CI_MARKER,
    '## Image',
    `\`\`\`bash\ndocker pull ${IMAGE}:${tag}\n\`\`\``,
    `Digest: \`${digest}\``,
    '## Files',
    `- \`${sbomName(tag)}\`: the CycloneDX 1.6 SBOM of the image, its OS packages, its Node.js runtime and the application's packages.`,
  ];
  return `${blocks.join('\n\n')}\n`;
};
