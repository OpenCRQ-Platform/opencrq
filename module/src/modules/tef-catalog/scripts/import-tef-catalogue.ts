/* eslint-disable no-console, func-style */
/**
 * Imports a threat event frequency catalogue package (a folder holding `catalogue.json` and
 * `rows.csv`, such as the `out/package` the catalogue builder writes) after checking it:
 *   npx tsx import-tef-catalogue.ts <package folder>
 *
 * Writes ../data/<catalogue id>.json, both files verbatim. The platform checks the package again
 * when it first reads it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectorsData } from '../../sectors/data/sectors-data';
import { loadTefCataloguePackage } from '../catalogue-package';

function main() {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: npx tsx import-tef-catalogue.ts <package folder>');
    process.exit(2);
  }
  const files = {
    catalogue: JSON.parse(readFileSync(join(dir, 'catalogue.json'), 'utf-8')) as unknown,
    rowsCsv: readFileSync(join(dir, 'rows.csv'), 'utf-8').replaceAll('\r\n', '\n'),
  };
  const catalogue = loadTefCataloguePackage(files, new Set(sectorsData.map((sector) => sector.name)));
  const output = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', `${catalogue.id}.json`);
  writeFileSync(output, `${JSON.stringify(files)}\n`);
  console.log(`${catalogue.id} ${catalogue.version}: ${catalogue.rows.length} rows, ${catalogue.sources.length} sources, written to ${output}`);
}

main();
