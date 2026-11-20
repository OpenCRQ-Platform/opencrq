import { createContext, useContext } from 'react';

export type AuthContextType = {
  status: 'logged-in',
  user: { id: string, email: string, name: string | null, title: string | null },
  session: { sessionExpiresAt: string | null, renewsThroughXtmOne: boolean },
  logout: () => Promise<void>,
} | {
  status: 'logged-out',
} | null

export const AuthContext = createContext<AuthContextType>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
