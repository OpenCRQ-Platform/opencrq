/**
 * The parts of `scripts/notice.mjs` that read files and render text. Nothing here starts a build.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const normalizeText = (text) => {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd());
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
};

const CODE_EXTENSIONS = /\.(?:[cm]?js|tsx?|css|py|sh|sql)$/i;
const LARGE_DATA_BYTES = 10_000;
// Measured on the repository: its catalogues sit at 0.63 and above, its code at 0.59 and below.
const DATA_LITERAL_SHARE = 0.6;

/** The share of a TypeScript file's tokens, whitespace and comments aside, that its string and template literals make up. */
export const literalShare = (fileName, text) => {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let literal = 0;
  let tokens = 0;
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const width = node.end - node.getStart(source);
      literal += width;
      tokens += width;
      return;
    }
    const children = node.getChildren(source);
    if (children.length === 0) {
      tokens += node.end - node.getStart(source);
      return;
    }
    children.forEach(visit);
  };
  visit(source);
  return tokens === 0 ? 0 : literal / tokens;
};

/**
 * Whether a file is data the notice policy has to classify: anything under a `data/`, `fixtures/`,
 * `__fixtures__/` or `test-data/` directory, the served maps and front-end assets, the model files,
 * a `.generated.ts`, and from 10 KB any file that is not code, or a `.ts` file made mostly of string
 * literals. A test, a Markdown file or an ignored path never is. `readText` is called only for that
 * last case.
 */
export const isDataFile = (file, size, ignored, readText) => {
  if (/\.(?:md|test\.tsx?)$/.test(file) || ignored.some(({ pattern }) => pattern.test(file))) {
    return false;
  }
  if (/(?:^|\/)(?:data|fixtures|__fixtures__|test-data)\//.test(file)
    || file.startsWith('back/static/')
    || file.startsWith('front/public/')
    || file.includes('/outcome-counter-model/')
    || file.endsWith('.generated.ts')) {
    return true;
  }
  if (size < LARGE_DATA_BYTES) {
    return false;
  }
  return !CODE_EXTENSIONS.test(file) || (file.endsWith('.ts') && literalShare(file, readText()) >= DATA_LITERAL_SHARE);
};

/** The data files among the files git lists (tracked, and untracked but not ignored). */
export const listDataFiles = (root, files, ignored) => files
  .filter((file) => fs.existsSync(path.join(root, file)))
  .filter((file) => isDataFile(file, fs.statSync(path.join(root, file)).size, ignored, () => fs.readFileSync(path.join(root, file), 'utf8')));

/**
 * The data files no registry entry names, and the registry paths that name no data file. A file may
 * be named by several entries (a catalogue that is also a source of identifiers).
 */
export const classifyDataFiles = (dataFiles, entries) => {
  const named = new Set(entries.flatMap(({ files }) => files));
  const present = new Set(dataFiles);
  return {
    unclassified: dataFiles.filter((file) => !named.has(file)),
    stale: entries.flatMap(({ label, files }) => files.filter((file) => !present.has(file)).map((file) => `${label}: ${file}`)),
  };
};

export const checkVersions = (root, datasets) => datasets.flatMap((dataset) => dataset.versions.flatMap(({ file, pattern, expected }) => {
  const match = pattern.exec(fs.readFileSync(path.join(root, file), 'utf8'));
  if (!match) {
    return [`${dataset.id}: no version found in ${file} by ${pattern}`];
  }
  return match[1] === expected
    ? []
    : [`${dataset.id}: ${file} says ${match[1]}, the registry says ${expected}: read the notice again and update scripts/notice/registry.mjs`];
}));

const RULE = '='.repeat(80);

export const renderNotice = ({ datasets, runtimeSources, firstParty, noticeText }) => {
  const dataBlocks = datasets.map((dataset) => [
    RULE,
    `${dataset.title} (${dataset.release})`,
    RULE,
    '',
    'Used in:',
    ...dataset.files.map((file) => `  ${file}`),
    '',
    `Copyright line taken from: ${dataset.copyrightFrom}.`,
    '',
    normalizeText(noticeText(dataset.notice)).trimEnd(),
  ].join('\n'));

  const runtimeBlocks = runtimeSources.map((source) => [
    RULE,
    source.title,
    RULE,
    '',
    `Fetched by ${source.readBy} when it runs; not shipped with OpenCRQ.`,
    '',
    normalizeText(noticeText(source.notice)).trimEnd(),
  ].join('\n'));

  const declarations = firstParty
    .filter((entry) => entry.declaration)
    .map((entry) => [entry.declaration, '', 'Files:', ...entry.files.map((file) => `  ${file}`)].join('\n'));

  return normalizeText([
    'OpenCRQ',
    'Copyright (c) 2026 Filigran SAS',
    '',
    'OpenCRQ is licensed as stated in the LICENSE file. This file carries the notices that the',
    'third-party data shipped with OpenCRQ requires, for the source repository and for the Docker',
    'image built from it, and credits the third-party data OpenCRQ fetches at runtime.',
    '',
    'The notices of the third-party software (the dependencies and the fonts) are in',
    'THIRD_PARTY_NOTICES, which the Filigran Flow checker GDL-XTM-0002 writes when the image is built.',
    '',
    'Generated by `yarn notice:build` from scripts/notice/. Do not edit it by hand.',
    '',
    '',
    'THIRD-PARTY DATA',
    '',
    dataBlocks.join('\n\n\n'),
    '',
    '',
    'THIRD-PARTY DATA FETCHED AT RUNTIME',
    '',
    runtimeBlocks.join('\n\n\n'),
    '',
    '',
    'FILIGRAN DATA',
    '',
    declarations.join('\n\n'),
  ].join('\n'));
};
