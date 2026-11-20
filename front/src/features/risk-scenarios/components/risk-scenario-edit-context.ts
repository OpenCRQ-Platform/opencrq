import { createContext, use } from 'react';

/** Opens the scenario page's Edit drawer on its Primary Assets field, `null` outside a scenario page. */
export const RiskScenarioEditContext = createContext<(() => void) | null>(null);

export const useOpenRiskScenarioEdit = (): (() => void) | null => use(RiskScenarioEditContext);
