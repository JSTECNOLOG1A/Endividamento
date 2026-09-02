import React from "react";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { PlatformProvider } from '@/lib/PlatformContext';
import { GroupProvider } from '@/lib/GroupContext';
import { LayoutProvider } from '@/lib/LayoutContext';
import { ProcessingProvider } from '@/lib/ProcessingContext';
import Login from '@/components/Login';
import Signup from '@/components/Signup';
import CompleteSignup from '@/components/CompleteSignup';
import ForgotPassword from '@/components/ForgotPassword';
import SetPassword from '@/components/SetPassword';
import Onboarding from '@/components/Onboarding';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, login } = useAuth();
  const [loginError, setLoginError] = React.useState(null);
  const [loginLoading, setLoginLoading] = React.useState(false);

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-slate-800">API local indisponível</h1>
          <p className="text-sm text-slate-600">{authError.message}</p>
          <p className="text-xs text-slate-500">Suba o stack com docker compose up --build e recarregue.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/criar-conta" element={<Signup />} />
        <Route path="/concluir-cadastro" element={<CompleteSignup />} />
        <Route path="/esqueci-senha" element={<ForgotPassword />} />
        <Route path="/redefinir-senha" element={<SetPassword />} />
        <Route path="/aceitar-convite" element={<SetPassword />} />
        <Route
          path="*"
          element={(
            <Login
              error={loginError}
              loading={loginLoading}
              onSubmit={async (email, password) => {
                setLoginError(null);
                setLoginLoading(true);
                try {
                  await login(email, password);
                } catch (error) {
                  setLoginError(error.message || "Falha no login");
                } finally {
                  setLoginLoading(false);
                }
              }}
            />
          )}
        />
      </Routes>
    );
  }

  return (
    <PlatformProvider>
    <GroupProvider>
    <LayoutProvider>
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/onboarding" element={
        <LayoutWrapper currentPageName="Onboarding">
          <Onboarding />
        </LayoutWrapper>
      } />
      <Route path="/criar-conta" element={<Navigate to="/" replace />} />
      <Route path="/concluir-cadastro" element={<Navigate to="/" replace />} />
      <Route path="/esqueci-senha" element={<Navigate to="/" replace />} />
      <Route path="/redefinir-senha" element={<Navigate to="/" replace />} />
      <Route path="/aceitar-convite" element={<Navigate to="/" replace />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </LayoutProvider>
    </GroupProvider>
    </PlatformProvider>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <ProcessingProvider>
          <Router>
            <NavigationTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </ProcessingProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
