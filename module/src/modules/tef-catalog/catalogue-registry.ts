import type { TefCatalogue } from './catalogue-package';
import { sectorsData } from '../sectors/data/sectors-data';
import { loadTefCataloguePackage } from './catalogue-package';
import openDataPackage from './data/opencrq-open-data.json';

let current: TefCatalogue | undefined;

/** Checked and indexed on first read: the backend boots without paying for the rows until a frequency is read. */
export const currentTefCatalogue = (): TefCatalogue => {
  current ??= loadTefCataloguePackage(openDataPackage, new Set(sectorsData.map((sector) => sector.name)));
  return current;
};

/** The catalogue an estimate was read from, `undefined` once the platform no longer ships that version. */
export const tefCatalogueOf = (id: string, version: string): TefCatalogue | undefined => {
  const catalogue = currentTefCatalogue();
  return catalogue.id === id && catalogue.version === version ? catalogue : undefined;
};
