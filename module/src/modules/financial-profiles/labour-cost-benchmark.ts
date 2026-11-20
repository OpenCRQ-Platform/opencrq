/**
 * Loaded daily labour cost benchmark by country (USD/day), feeding the questionnaire header's
 * editable default. Coarse anchors read-only and reseeded like `loss-drivers/data`: never
 * tenant-authored, only ever a starting point the organization corrects.
 */
export const LOADED_DAILY_LABOUR_COST_BENCHMARK_USD: Record<string, number> = {
  USA: 520,
  CAN: 460,
  GBR: 440,
  FRA: 480,
  DEU: 500,
  ITA: 400,
  ESP: 360,
  NLD: 490,
  BEL: 470,
  CHE: 620,
  SWE: 470,
  NOR: 560,
  DNK: 520,
  FIN: 460,
  IRL: 470,
  PRT: 280,
  POL: 220,
  CZE: 240,
  AUT: 480,
  GRC: 250,
  SGP: 380,
  JPN: 400,
  KOR: 320,
  AUS: 470,
  NZL: 420,
  BRA: 180,
  MEX: 140,
  IND: 90,
  CHN: 210,
  ZAF: 150,
  ARE: 300,
};

/** Applied when the organization's country carries no benchmark entry above. */
export const DEFAULT_LOADED_DAILY_LABOUR_COST_USD = 300;

export const loadedDailyLabourCostBenchmark = (countryIsoAlpha3: string | null | undefined): number => {
  if (!countryIsoAlpha3) {
    return DEFAULT_LOADED_DAILY_LABOUR_COST_USD;
  }
  return LOADED_DAILY_LABOUR_COST_BENCHMARK_USD[countryIsoAlpha3] ?? DEFAULT_LOADED_DAILY_LABOUR_COST_USD;
};
