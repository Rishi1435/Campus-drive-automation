import React, { createContext, useContext, useState } from 'react';
import { apiFetch } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });

  const persist = (t, u) => {
    setToken(t);
    setUser(u);
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(u));
  };

  const register = async (email, password) => {
    const data = await apiFetch('/api/auth/register', { method: 'POST', body: { email, password } });
    persist(data.token, data.user);
  };

  const login = async (email, password) => {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
    persist(data.token, data.user);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  return (
    <AuthContext.Provider value={{ token, user, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
