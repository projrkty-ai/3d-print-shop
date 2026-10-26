import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, getAdminToken, setAdminToken } from '../api/client';

interface AdminAuthValue {
  isAdmin: boolean;
  /** Changes on sign-in/out, so data that depends on admin access can reload. */
  token: string | null;
  /** Returns false for a wrong key; throws if the server can't be reached. */
  signIn: (token: string) => Promise<boolean>;
  signOut: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(getAdminToken);

  const signIn = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed || !(await api.isValidAdminToken(trimmed))) return false;
    setAdminToken(trimmed);
    setToken(trimmed);
    return true;
  }, []);

  const signOut = useCallback(() => {
    setAdminToken(null);
    setToken(null);
  }, []);

  const value = useMemo(() => ({ isAdmin: token !== null, token, signIn, signOut }), [token, signIn, signOut]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>');
  return ctx;
}
