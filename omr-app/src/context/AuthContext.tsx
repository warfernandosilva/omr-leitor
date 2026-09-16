import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import * as api from '../utils/api';
import type { AuthUser } from '../utils/api';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, nome: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem('omr_user');
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('omr_token'));
  const [loading, setLoading] = useState<boolean>(!!localStorage.getItem('omr_token'));

  useEffect(() => {
    const t = localStorage.getItem('omr_token');
    if (!t) {
      setLoading(false);
      return;
    }
    api.getMe()
      .then(u => {
        setUser(u);
        setToken(t);
      })
      .catch(() => {
        localStorage.removeItem('omr_token');
        localStorage.removeItem('omr_user');
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login(email, password);
    setToken(data.access_token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, nome: string, password: string) => {
    const data = await api.register(email, nome, password);
    setToken(data.access_token);
    setUser(data.user);
  }, []);

  const logoutCb = useCallback(() => {
    api.logout();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout: logoutCb }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
