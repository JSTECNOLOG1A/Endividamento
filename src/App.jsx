import React from "react";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ProcessingProvider } from '@/lib/ProcessingContext';
import Login from '@/components/Login';

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
    );
  }

  // Render the main app
  return (
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
      <Route path="*" element={<PageNotFound />} />
    </Routes>
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
