import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44, getToken, setToken } from '@/api/base44Client';
import { setPlatformTenantId } from '@/api/platformScope';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setIsLoadingAuth(true);
      setAuthError(null);
      setAppPublicSettings({
        id: "local",
        public_settings: { requires_auth: true },
      });

      if (!getToken()) {
        setIsAuthenticated(false);
        setUser(null);
        return;
      }

      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (error) {
      if (error.status === 401) {
        setIsAuthenticated(false);
        setUser(null);
        return;
      }
      setAuthError({
        type: 'unknown',
        message: error.message || 'Não foi possível conectar à API',
      });
      setIsAuthenticated(false);
    } finally {
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const login = async (email, password) => {
    const currentUser = await base44.auth.login(email, password);
    setUser(currentUser);
    setIsAuthenticated(true);
    setAuthError(null);
    return currentUser;
  };

  const acceptSession = async (token, sessionUser) => {
    setToken(token);
    if (sessionUser) {
      setUser(sessionUser);
      setIsAuthenticated(true);
      setAuthError(null);
      return sessionUser;
    }
    return checkAppState();
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    setPlatformTenantId("");
    base44.auth.logout();
  };

  const navigateToLogin = () => {
    logout();
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      login,
      acceptSession,
      logout,
      navigateToLogin,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
