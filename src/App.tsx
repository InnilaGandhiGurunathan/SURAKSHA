import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { store, useAppState } from '@/store/hooks';
import { Login } from '@/pages/Login';
import { TravellerHome } from '@/pages/traveller/TravellerHome';
import { StartJourney } from '@/pages/traveller/StartJourney';
import { ActiveJourney } from '@/pages/traveller/ActiveJourney';
import { ExitModePage } from '@/pages/traveller/ExitModePage';
import { TrustedCircle } from '@/pages/traveller/TrustedCircle';
import { TravellerIncidents } from '@/pages/traveller/TravellerIncidents';
import { IncidentDetail } from '@/pages/traveller/IncidentDetail';
import { Community } from '@/pages/traveller/Community';
import { Learn } from '@/pages/traveller/Learn';
import { Profile } from '@/pages/traveller/Profile';
import { GuardianDashboard } from '@/pages/guardian/GuardianDashboard';
import { GuardianJourneys } from '@/pages/guardian/GuardianJourneys';
import { GuardianAlerts } from '@/pages/guardian/GuardianAlerts';
import { GuardianIncidents } from '@/pages/guardian/GuardianIncidents';
import { GuardianContacts } from '@/pages/guardian/GuardianContacts';
import { GuardianSettings } from '@/pages/guardian/GuardianSettings';
import { Welcome } from '@/pages/Welcome';
import { useAuth, landingGateFor } from '@/store/authStore';
import { BrandLogo } from '@/components/brand/BrandLogo';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/**
 * Keeps the active role in step with the URL.
 *
 * The demo switcher is the normal way to change role, but a deep link or a
 * refresh on a `/guardian/...` page must not render guardian content under the
 * traveller navigation.
 */
function RoleFromRoute() {
  const { pathname } = useLocation();
  const { role } = useAppState();
  useEffect(() => {
    const wanted = pathname.startsWith('/guardian') ? 'guardian' : pathname.startsWith('/traveller') ? 'traveller' : role;
    if (wanted !== role) store.setRole(wanted);
  }, [pathname, role]);
  return null;
}

/**
 * AppRoutes — `/login` and the landing (`/`) render full-screen and standalone.
 * The landing (Welcome) is the first thing a fresh visitor sees; a signed-in
 * visitor or one who already entered the app skips straight through.
 */
function AppRoutes() {
  const { role } = useAppState();
  const { user } = useAuth();
  const gate = landingGateFor(user);
  return (
    <>
      <RoleFromRoute />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<LandingRoot gate={gate} role={role} />} />
        <Route
          path="*"
          element={
            <LandingRedirect gate={gate}>
              <AppShell>
                <Routes>
                  <Route path="/welcome" element={<Welcome />} />

                  {/* Traveller */}
                  <Route path="/traveller" element={<TravellerHome />} />
                  <Route path="/traveller/journey" element={<ActiveJourney />} />
                  <Route path="/traveller/start" element={<StartJourney />} />
                  <Route path="/traveller/exit" element={<ExitModePage />} />
                  <Route path="/traveller/circle" element={<TrustedCircle />} />
                  <Route path="/traveller/incidents" element={<TravellerIncidents />} />
                  <Route path="/traveller/incidents/:incidentId" element={<IncidentDetail role="traveller" />} />
                  <Route path="/traveller/community" element={<Community />} />
                  <Route path="/traveller/learn" element={<Learn />} />
                  <Route path="/traveller/profile" element={<Profile />} />

                  {/* Guardian */}
                  <Route path="/guardian" element={<GuardianDashboard />} />
                  <Route path="/guardian/journeys" element={<GuardianJourneys />} />
                  <Route path="/guardian/journeys/:journeyId" element={<GuardianJourneys />} />
                  <Route path="/guardian/alerts" element={<GuardianAlerts />} />
                  <Route path="/guardian/incidents" element={<GuardianIncidents />} />
                  <Route path="/guardian/incidents/:incidentId" element={<IncidentDetail role="guardian" />} />
                  <Route path="/guardian/contacts" element={<GuardianContacts />} />
                  <Route path="/guardian/settings" element={<GuardianSettings />} />

                  <Route path="*" element={<Navigate to={role === 'guardian' ? '/guardian' : '/traveller'} replace />} />
                </Routes>
              </AppShell>
            </LandingRedirect>
          }
        />
      </Routes>
    </>
  );
}

/**
 * `/` is the first thing a visitor sees. Fresh, signed-out visitors get the
 * full-screen landing; anyone signed in or returning goes straight to the app.
 */
function LandingRoot({ gate, role }: { gate: 'landing' | 'app' | 'demo'; role: 'traveller' | 'guardian' }) {
  if (gate === 'landing') {
    return (
      <div className="min-h-screen bg-ink-50 px-4 py-8 sm:px-6">
        <Welcome />
      </div>
    );
  }
  return <Navigate to={role === 'guardian' ? '/guardian' : '/traveller'} replace />;
}

/**
 * Signed-in visitors, or visitors who already chose to see the app, pass
 * through. Everyone else is routed to the landing page (`/`).
 */
function LandingRedirect({
  gate,
  children,
}: {
  gate: 'landing' | 'app' | 'demo';
  children: React.ReactNode;
}) {
  const location = useLocation();
  if (gate === 'landing' && location.pathname !== '/') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const { ready } = useAppState();

  useEffect(() => {
    store.hydrate();
    return () => store.stop();
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <BrandLogo size="xl" variant="full" showTagline={false} />
          <p className="text-sm font-semibold text-ink-500">Starting SURAKSHA…</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ScrollToTop />
      <AppRoutes />
    </BrowserRouter>
  );
}
