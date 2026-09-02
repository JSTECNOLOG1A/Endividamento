/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Accounting from './pages/Accounting';
import AccountsPayable from './pages/AccountsPayable';
import AccountsReceivable from './pages/AccountsReceivable';
import CDIManager from './pages/CDIManager';
import Configuracoes from './pages/Configuracoes';
import Consolidation from './pages/Consolidation';
import Contracts from './pages/Contracts';
import GovernancePage from './pages/Governance';
import {
  GovernanceGroups,
  GovernanceEntities,
  GovernanceBanks,
  GovernanceNatures,
  GovernanceChart,
} from './pages/governancePages';
import GuaranteedAccounts from './pages/GuaranteedAccounts';
import SettingsPage from './pages/Settings';
import {
  SettingsIntegrations,
  SettingsSchedules,
  SettingsParameters,
  SettingsAccountingLogic,
  SettingsUsers,
  SettingsLog,
  SettingsAccount,
} from './pages/settingsPages';
import Simulator from './pages/Simulator';
import UserManual from './pages/UserManual';
import __Layout from './layouts/AppLayout.jsx';


export const PAGES = {
    "Accounting": Accounting,
    "AccountsPayable": AccountsPayable,
    "AccountsReceivable": AccountsReceivable,
    "CDIManager": CDIManager,
    "Configuracoes": Configuracoes,
    "Consolidation": Consolidation,
    "Contracts": Contracts,
    "Governance": GovernancePage,
    "GovernanceGroups": GovernanceGroups,
    "GovernanceEntities": GovernanceEntities,
    "GovernanceBanks": GovernanceBanks,
    "GovernanceNatures": GovernanceNatures,
    "GovernanceChart": GovernanceChart,
    "GuaranteedAccounts": GuaranteedAccounts,
    "Settings": SettingsPage,
    "SettingsIntegrations": SettingsIntegrations,
    "SettingsSchedules": SettingsSchedules,
    "SettingsParameters": SettingsParameters,
    "SettingsAccountingLogic": SettingsAccountingLogic,
    "SettingsUsers": SettingsUsers,
    "SettingsLog": SettingsLog,
    "SettingsAccount": SettingsAccount,
    "Simulator": Simulator,
    "UserManual": UserManual,
}

export const pagesConfig = {
    mainPage: "Simulator",
    Pages: PAGES,
    Layout: __Layout,
};