import type { RevenueBand } from '../organizations/constants';
import type { TefNotMeasured, TefSizeClass, TefSizeSource } from '../tef-catalog/catalogue-constants';
import type { TefMode } from '../risk-scenarios/schema';
import type { tefEstimates } from './schema';

export type { TefMode };

export type TefEstimate = typeof tefEstimates.$inferSelect;

/** PERT distribution range for sampling. */
export interface PertRange {
  min: number,
  likely: number,
  max: number,
}

/** TEF (Threat Event Frequency) input, a three-point estimate sampled via PERT. */
export interface TefInput {
  min: number,
  likely: number,
  max: number,
}

/** A source a catalogue names; the optional fields are null when the package leaves them out. */
export interface TefCatalogSource {
  id: string,
  title: string,
  publisher: string,
  url: string | null,
  licence: string | null,
  /** The text the source's licence requires to be shown with figures derived from it. */
  attribution: string | null,
  /** The year, or first and last years, the source's data describe. */
  referencePeriod: string | null,
}

export interface TefSizeClassShare {
  sizeClass: TefSizeClass,
  /** The class's weight in the read, 1 when the size came from an employee count. */
  weight: number,
}

/** A catalogue package: its stable id and the version an estimate was read from. */
export interface TefCatalogueRef {
  id: string,
  version: string,
}

/** One attack outcome's frequency read in a catalogue package for a profile. */
export interface TefCatalogRead {
  catalogue: TefCatalogueRef,
  /** The profile's country, `null` when it declares none. */
  countryIsoAlpha3: string | null,
  /** The profile's sector, `null` when it declares none. */
  sectorName: string | null,
  sizeSource: TefSizeSource,
  /** The row's country: ISO alpha-2, or `*` for the row of every country the catalogue does not cover. */
  country: string,
  /** The row's sector, `null` for the row of every sector. */
  sector: string | null,
  /** One class from an employee count, the classes a revenue band spans, every class without either. */
  sizeClasses: Array<TefSizeClassShare>,
  /** Attack attempts per organization per year, the minimum, mode and maximum of a PERT. */
  low: number,
  likely: number,
  high: number,
  /** The dimensions the row does not measure for itself, its range being wider for it. */
  notMeasured: Array<TefNotMeasured>,
  /** `null` once the platform no longer ships the catalogue the row was read from. */
  sources: Array<TefCatalogSource> | null,
}

/**
 * An auto estimate with the catalogue read it records. An estimate stored from a multiplier vintage
 * names its `catalogVintage` and has no `read`; one read from a package names its `catalogId` and `catalogVersion`.
 */
export type TefEstimateWithRead = Pick<TefEstimate, 'id' | 'riskScenarioId' | 'catalogVintage' | 'catalogId' | 'catalogVersion' | 'min' | 'likely' | 'max' | 'positioned' | 'fallbackReason' | 'createdAt'> & {
  read: TefCatalogRead | null,
};

export interface TefCatalogProfile {
  countryId: string | null,
  sectorId: string | null,
  employeeCount: number | null,
  revenueBand: RevenueBand | null,
}

/**
 * Every outcome's read for one profile, the tenant's own attack outcome ids, and the attempts over
 * all of them (`totalOfRanges`).
 */
export interface TefCatalogReading {
  outcomes: Array<{ attackOutcomeId: string, name: string, read: TefCatalogRead }>,
  total: { low: number, likely: number, high: number },
}

/** A risk scope's reading, its profile read from the scope's own country, sector and size. */
export interface TefScopeReading extends TefCatalogReading {
  organizationId: string,
}

/** The catalogue package in force: its sources, and how each product value maps onto its rows. */
export interface TefCatalogOverview {
  id: string,
  version: string,
  /** The date the package was built, `YYYY-MM-DD`. */
  builtOn: string,
  publisher: string,
  sources: Array<TefCatalogSource>,
  sizeClasses: Array<TefSizeClass>,
  outcomes: Array<{ id: string, name: string }>,
  /** `measured` when some row names the sector; one no row names is read on the row of every sector. */
  sectors: Array<{ id: string, name: string, measured: boolean }>,
  /** The row country each country is read at: its own ISO alpha-2, or `*` when the catalogue does not cover it. */
  countries: Array<{ id: string, name: string, isoAlpha3: string, readAs: string }>,
  /** The size classes a revenue band spans when the profile has no employee count. */
  revenueBands: Array<{ revenueBand: RevenueBand, sizeClasses: Array<TefSizeClassShare> }>,
}
