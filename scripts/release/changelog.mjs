/**
 * The changelog of a release: the issues that the pull requests merged on `main` since the previous
 * release closed, grouped by kind. Pull requests themselves are not listed: the compare link that
 * ends the changelog leads to them.
 */

const TITLE = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?:\s*(?<description>.+)$/;

/** An issue title's Conventional Commits type, whether it marks a breaking change, and its text. */
export const parseTitle = (title) => {
  const trimmed = title.trim().replace(/\s*\(#\d+\)$/, '');
  const match = TITLE.exec(trimmed);
  if (match === null) {
    return { type: null, breaking: false, description: trimmed };
  }
  return { type: match.groups.type, breaking: match.groups.breaking === '!', description: match.groups.description };
};

const SECTIONS = [
  { id: 'breaking', heading: 'Breaking changes' },
  { id: 'security', heading: 'Security' },
  { id: 'enhancements', heading: 'Enhancements' },
  { id: 'fixes', heading: 'Bug fixes' },
  { id: 'maintenance', heading: 'Maintenance', collapsed: true },
];

const ENTERPRISE_EDITION = 'enterprise edition';

/**
 * The section an issue goes in: a breaking change (a `!` in its title, or the `breaking-change`
 * label) before anything, then security; otherwise its Type, or without one its `feature` or `bug`
 * label, or without either its title's type.
 */
export const sectionOf = ({ title, type, labels }) => {
  const parsed = parseTitle(title);
  if (parsed.breaking || labels.includes('breaking-change')) {
    return 'breaking';
  }
  if (labels.includes('security')) {
    return 'security';
  }
  const kind = { Feature: 'enhancements', Bug: 'fixes', Task: 'maintenance' }[type ?? ''];
  if (kind !== undefined) {
    return kind;
  }
  if (labels.includes('feature')) {
    return 'enhancements';
  }
  if (labels.includes('bug')) {
    return 'fixes';
  }
  return { feat: 'enhancements', fix: 'fixes' }[parsed.type ?? ''] ?? 'maintenance';
};

/**
 * The issues a release holds, out of those its pull requests reference as closing: each one closed
 * and whose last closing was by one of those pull requests or commits. An issue closed by hand, or
 * reopened since, is left out, and one several pull requests reference goes in the release that
 * holds the one that closed it.
 */
export const releasedIssues = ({ issues, pullRequests, commits }) => issues.filter(({ state, closer }) => state === 'CLOSED'
  && closer !== null
  && (pullRequests.has(closer.pullRequest) || commits.has(closer.commit)));

const line = (issue) => {
  const { description } = parseTitle(issue.title);
  const text = description.charAt(0).toUpperCase() + description.slice(1);
  const edition = issue.labels.includes(ENTERPRISE_EDITION) ? ' · *Enterprise Edition*' : '';
  return `- ${text} (#${issue.number})${edition}`;
};

/** The changelog's markdown, its sections in order, empty ones left out, ending on the compare link. */
export const renderChangelog = ({ issues, compareUrl }) => {
  const blocks = [];
  for (const section of SECTIONS) {
    const lines = issues
      .filter((issue) => sectionOf(issue) === section.id)
      .sort((a, b) => a.number - b.number)
      .map(line);
    if (lines.length === 0) {
      continue;
    }
    blocks.push(section.collapsed
      ? `<details>\n<summary><strong>${section.heading}</strong> (${lines.length})</summary>\n\n${lines.join('\n')}\n\n</details>`
      : `### ${section.heading}\n\n${lines.join('\n')}`);
  }
  if (blocks.length === 0) {
    blocks.push('No issue was closed in this release.');
  }
  blocks.push(`**Full changelog**: ${compareUrl}`);
  return blocks.join('\n\n');
};
