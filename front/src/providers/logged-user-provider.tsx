import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

interface LoggedUserContextType {
  userId: string,
}

const LoggedUserContext = createContext<LoggedUserContextType | undefined>(undefined);

export const LoggedUserProvider = ({ children, userId }: { children: ReactNode, userId: string }) => (
  <LoggedUserContext.Provider value={{ userId }}>
    {children}
  </LoggedUserContext.Provider>
);

export const useLoggedUser = (): LoggedUserContextType => {
  const context = useContext(LoggedUserContext);
  if (context === undefined) {
    throw new Error('useLoggedUser must be used within a LoggedUserProvider');
  }
  return context;
};
