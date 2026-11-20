/**
 * Render `.agents/instructions/` into what Claude Code reads (`.claude/rules/`) and what the pull
 * request reviewer reads (`.github/instructions/`).
 *
 * Usage: node scripts/render-agent-files.mjs [--check]
 *   --check  compare instead of writing, and exit 1 on any difference (this is what CI runs)
 *
 * Skills are not rendered: they live in `.claude/skills/`, which Claude Code reads. Each target
 * gets the instruction body verbatim in the file it reads, and neither of those files is meant to
 * be edited.
 *
 * The Claude side carries the body rather than an `@` import of the source, because an import is
 * expanded at session start whatever the rule's `paths` say: a stub would put every instruction
 * in every session's context and the scoping would buy nothing. A rule holding its own body is
 * withheld until Claude works on a file its globs match.
 *
 * Frontmatter: `applyTo` carries the globs, `description` is the line a reader gets before deciding
 * to load the rest, and `assistants` narrows the render to one of them. `assistants` never reaches
 * the model, it is stripped from every rendered file.
 *
 * Consequence for the content: a rendered file sits at a different depth from its source, so it
 * must carry no depth-relative link. Name paths from the repository root instead.
 */

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = '.agents/instructions';
const INDEX = 'AGENTS.md';
const ASSISTANTS = ['claude', 'copilot'];
const OUT = {
  claude: (name) => `.claude/rules/${name}.md`,
  copilot: (name) => `.github/instructions/${name}.instructions.md`,
};

const BANNER = (source) => `<!-- Generated from ${source} by scripts/render-agent-files.mjs. Edit the source, not this file. -->`;

const unquote = (value) => value.replace(/^['"]|['"]$/g, '');
/** Commas separate globs, except inside a brace set: `front/**\/*.{tsx,css}` is one glob, not two. */
const splitGlobs = (applyTo) => {
  const out = [];
  let depth = 0;
  let current = '';
  for (const character of unquote(applyTo)) {
    if (character === '{') {
      depth += 1;
    }
    if (character === '}') {
      depth -= 1;
    }
    if (character === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  out.push(current);
  return out.map((g) => g.trim()).filter(Boolean);
};

/** Claude's `paths` takes one pattern per entry, so a brace set becomes one entry per alternative. */
const expandBraces = (glob) => {
  const brace = glob.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  if (!brace) {
    return [glob];
  }
  return brace[2].split(',').flatMap((alternative) => expandBraces(`${brace[1]}${alternative.trim()}${brace[3]}`));
};

const globs = (applyTo) => splitGlobs(applyTo).flatMap(expandBraces);

/** Line endings differ between a checkout on Windows and one on CI, and say nothing about drift. */
const normalise = (text) => text.replace(/\r\n/g, '\n');

const render = (assistant, rule) => (assistant === 'copilot'
  ? [
    `---\napplyTo: ${rule.fields.applyTo}\ndescription: ${rule.fields.description}\n---\n`,
    BANNER(rule.source),
    '',
    rule.body,
  ].join('\n')
  : [
    `---\npaths:\n${globs(rule.fields.applyTo).map((g) => `  - "${g}"`).join('\n')}\n---\n`,
    BANNER(rule.source),
    '',
    // The description is a title, so it ends without a period and needs one before the sentence.
    `${unquote(rule.fields.description).replace(/\.?$/, '.')} The conventions below apply to the file being read.`,
    '',
    rule.body,
  ].join('\n'));

const parse = (file) => {
  const source = path.posix.join(SOURCE_DIR, path.basename(file));
  const raw = normalise(fs.readFileSync(file, 'utf8'));
  const matched = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!matched) {
    throw new Error(`${source}: no YAML frontmatter.`);
  }

  const fields = Object.fromEntries([...matched[1].matchAll(/^([a-zA-Z]+):[ \t]*(.+?)[ \t]*$/gm)].map((m) => [m[1], m[2]]));
  for (const key of ['applyTo', 'description']) {
    if (!fields[key]) {
      throw new Error(`${source}: frontmatter has no '${key}'.`);
    }
  }

  const assistants = fields.assistants ? fields.assistants.split(/[,\s]+/).filter(Boolean) : ASSISTANTS;
  const unknown = assistants.filter((a) => !ASSISTANTS.includes(a));
  if (unknown.length) {
    throw new Error(`${source}: unknown assistant(s) ${unknown.join(', ')}. Known: ${ASSISTANTS.join(', ')}.`);
  }

  return { name: path.basename(file, '.md'), source, assistants, fields, body: raw.slice(matched[0].length).replace(/^\n+/, '') };
};

/**
 * Rendered files no source accounts for any more, which a deleted or renamed source leaves behind.
 * A rule left behind keeps serving the body it was rendered from, which is by then whatever its
 * source said before it was deleted. The build deletes them, the check reports them. Only files
 * carrying the banner are considered, so a
 * hand-written one is left alone.
 */
const orphans = (expected) => {
  const found = [];
  for (const assistant of ASSISTANTS) {
    const dir = path.dirname(OUT[assistant]('x'));
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir)) {
      const file = path.join(dir, entry);
      if (expected.has(path.normalize(file)) || !fs.statSync(file).isFile()) {
        continue;
      }
      if (!normalise(fs.readFileSync(file, 'utf8')).includes('by scripts/render-agent-files.mjs')) {
        continue;
      }
      found.push(file);
    }
  }
  return found;
};

const IGNORED = new Set(['node_modules', '.git', '.yarn', 'dist', 'build', 'coverage']);

const repoFiles = (dir = '.', out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) {
      continue;
    }
    const full = path.posix.join(dir, entry.name).replace(/^\.\//, '');
    if (entry.isDirectory()) {
      repoFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
};

/** Enough of a glob to answer "does this match anything": `**` crosses directories, `*` does not. */
const globToRegExp = (glob) => {
  const literal = (segment) => segment
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  const segments = glob.split('/');
  const body = segments.map((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      return last ? '.*' : '(?:[^/]+/)*';
    }
    return last ? literal(segment) : `${literal(segment)}/`;
  }).join('');
  return new RegExp(`^${body}$`);
};

/**
 * What the rendering itself cannot catch, and what a reader never notices: a glob that matches
 * nothing (the instruction then loads on no file at all), a link that only resolves from one of
 * the three copies, and an instruction missing from the deep-dive list agents actually read.
 */
const validate = (rules) => {
  const problems = [];
  const files = repoFiles();
  const index = fs.existsSync(INDEX) ? normalise(fs.readFileSync(INDEX, 'utf8')) : '';

  for (const rule of rules) {
    for (const glob of globs(rule.fields.applyTo)) {
      const matcher = globToRegExp(glob);
      if (!files.some((file) => matcher.test(file))) {
        problems.push(`${rule.source}: applyTo glob '${glob}' matches no file in the repository.`);
      }
    }
    for (const [, link] of rule.body.matchAll(/\]\(([^)\s#]+)/g)) {
      if (/^[a-z]+:/.test(link) || fs.existsSync(link)) {
        continue;
      }
      problems.push(`${rule.source}: link '${link}' does not resolve from the repository root.`);
    }
    if (index && !index.includes(`${rule.name}.instructions.md`)) {
      problems.push(`${rule.source}: missing from the deep-dive references of ${INDEX}.`);
    }
  }
  return problems;
};

const main = () => {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(SOURCE_DIR)) {
    return;
  }

  const stale = [];
  const expected = new Set();
  let written = 0;
  const sources = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.md')).sort();

  const parsed = [];
  for (const file of sources) {
    const rule = parse(path.join(SOURCE_DIR, file));
    parsed.push(rule);
    for (const assistant of rule.assistants) {
      const out = OUT[assistant](rule.name);
      expected.add(path.normalize(out));
      const content = render(assistant, rule);
      const current = fs.existsSync(out) ? normalise(fs.readFileSync(out, 'utf8')) : null;
      if (current === content) {
        continue;
      }
      if (check) {
        stale.push(`${current === null ? 'missing' : 'stale'}: ${out} (from ${rule.source})`);
        continue;
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, content, 'utf8');
      written += 1;
    }
  }

  for (const orphan of orphans(expected)) {
    if (check) {
      stale.push(`orphan: ${orphan} (its source under ${SOURCE_DIR} is gone)`);
      continue;
    }
    fs.rmSync(orphan);
    written += 1;
  }
  if (check) {
    stale.push(...validate(parsed));
  }

  if (stale.length) {
    process.stderr.write(`${stale.join('\n')}\n\nRun 'yarn agent:build' and commit the result.\n`);
    process.exit(1);
  }
  process.stdout.write(check
    ? `${sources.length} instruction(s) in sync.\n`
    : `${sources.length} instruction(s) rendered, ${written} file(s) written.\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
