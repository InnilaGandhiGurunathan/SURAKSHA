import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './hooks/useSession';
import { useMonitoring } from './hooks/useMonitoring';
import { useTheme } from './hooks/useTheme';
import { startAutoSync } from './services/sync';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingBlock } from './components/StatusPieces';

import SplashScreen from './screens/SplashScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import AuthScreen from './screens/AuthScreen';
import SetupScreen from './screens/SetupScreen';
import HomeScreen from './screens/HomeScreen';
import JourneysScreen from './screens/JourneysScreen';
import JourneyPlannerScreen from './screens/JourneyPlannerScreen';
import JourneyDetailScreen from './screens/JourneyDetailScreen';
import SosScreen from './screens/SosScreen';
import ContactsScreen from './screens/ContactsScreen';
import ReportsScreen from './screens/ReportsScreen';
import ReportDetailScreen from './screens/ReportDetailScreen';
import CommunityScreen from './screens/CommunityScreen';
import HistoryScreen from './screens/HistoryScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import SettingsScreen from './screens/SettingsScreen';
import GuardianScreen from './screens/GuardianScreen';
import AdminScreen from './screens/AdminScreen';
import PublicGuardianScreen from './screens/PublicGuardianScreen';
import ReportSiteScreen from './screens/ReportSiteScreen';
import NotFoundScreen from './screens/NotFoundScreen';

// The report form carries media handling and the 30-second countdown; loading it
// lazily keeps the first paint of the app small for a phone on a weak link.
const NewReportScreen = lazy(() => import('./screens/NewReportScreen'));

/**
 * Routing and app-level wiring.
 *
 * Two route trees:
 *  - `/app/*` — the authenticated, device-local app (shell with a persistent SOS
 *    control and bottom navigation);
 *  - everything else — onboarding, auth, first-run setup, and the two public
 *    pages (reporting website and token-based guardian dashboard) that must work
 *    with no account.
 */
export default function App() {
  const { user } = useSession();
  const theme = useTheme();

  useMonitoring(user?.id);

  // Theme is applied globally, including on the public pages, so a guardian
  // opening a link in dark mode gets a readable dashboard.
  useEffect(() => {
    document.documentElement.lang = 'en';
  }, [theme.resolved]);

  // Reconnect + periodic sync lives here so every authenticated screen gets it.
  useEffect(() => {
    if (!user) return undefined;
    return startAutoSync({ ownerId: user.id });
  }, [user?.id]);

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="p-6"><LoadingBlock label="Loading…" rows={2} /></div>}>
        <Routes>
          <Route path="/" element={<SplashScreen user={user} />} />
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route path="/auth" element={user ? <Navigate to="/app" replace /> : <AuthScreen />} />
          <Route path="/setup" element={user ? <SetupScreen /> : <Navigate to="/auth" replace />} />

          <Route path="/app" element={user ? <AppShell user={user} /> : <Navigate to="/auth" replace />}>
            <Route index element={<HomeScreen user={user!} />} />
            <Route path="journeys" element={<JourneysScreen user={user!} />} />
            <Route path="journeys/new" element={<JourneyPlannerScreen user={user!} />} />
            <Route path="journeys/:journeyId" element={<JourneyDetailScreen user={user!} />} />
            <Route path="sos" element={<SosScreen user={user!} />} />
            <Route path="contacts" element={<ContactsScreen user={user!} />} />
            <Route path="report" element={<ReportsScreen user={user!} />} />
            <Route
              path="report/new"
              element={
                <Suspense fallback={<div className="p-2"><LoadingBlock label="Opening the report form…" rows={2} /></div>}>
                  <NewReportScreen user={user!} />
                </Suspense>
              }
            />
            <Route path="report/:reportId" element={<ReportDetailScreen user={user!} />} />
            <Route path="community" element={<CommunityScreen user={user!} />} />
            <Route path="history" element={<HistoryScreen user={user!} />} />
            <Route path="notifications" element={<NotificationsScreen user={user!} />} />
            <Route path="settings" element={<SettingsScreen user={user!} />} />
            <Route path="guardian" element={<GuardianScreen user={user!} />} />
            <Route path="admin" element={<AdminScreen user={user!} />} />
          </Route>

          {/* Public pages: no account, no network required for the guardian view. */}
          <Route path="/g/:token" element={<PublicGuardianScreen />} />
          <Route path="/report-site" element={<ReportSiteScreen />} />

          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
