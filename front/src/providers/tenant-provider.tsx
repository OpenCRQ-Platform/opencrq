import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

interface TenantContextType {
  tenantId: string,
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider = ({ children, tenantId }: { children: ReactNode, tenantId: string }) => (
  <TenantContext.Provider value={{ tenantId }}>
    {children}
  </TenantContext.Provider>
);

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};

export const useOptionalTenant = () => useContext(TenantContext);
