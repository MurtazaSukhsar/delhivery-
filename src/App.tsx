import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient, useMe } from './lib/queries';
import { useSession } from './lib/auth';
import { Toaster } from './ui/display';
import { Component, type ErrorInfo } from 'react';
import { reportProblem } from './lib/report';
import Login from './pages/Login';

const Platform = lazy(() => import('./pages/platform/Platform'));
const AppLayout = lazy(() => import('./pages/app/Layout'));
const Deliveries = lazy(() => import('./pages/app/Deliveries'));
const DeliveryForm = lazy(() => import('./pages/app/DeliveryForm'));
const DeliveryDetail = lazy(() => import('./pages/app/DeliveryDetail'));
const Customers = lazy(() => import('./pages/app/Customers'));
const Vehicles = lazy(() => import('./pages/app/Vehicles'));
const Team = lazy(() => import('./pages/app/Team'));
const Money = lazy(() => import('./pages/app/Money'));
const Reports = lazy(() => import('./pages/app/Reports'));
const PrintNote = lazy(() => import('./pages/app/PrintNote'));
const Settings = lazy(() => import('./pages/app/admin/Settings'));
const DriverApp = lazy(() => import('./pages/driver/DriverApp'));
const TrackPage = lazy(() => import('./pages/track/TrackPage'));

const Loading = () => (
  <p role="status" className="p-6 text-ink-2">
    Loading…
  </p>
);
const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

function RequireAuth({ children }: { children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  if (s === undefined) return <Loading />;
  if (!s) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

/** Sends each person to their part of the app. */
function Home() {
  const me = useMe();
  if (me.isLoading) return <Loading />;
  if (me.error) return <Navigate to="/login" replace state={{ error: me.error.message }} />;
  const role = me.data?.user.role;
  if (role === 'super_admin') return <Navigate to="/platform" replace />;
  if (role === 'driver') return <Navigate to="/driver" replace />;
  return <Navigate to="/app" replace />;
}

/** If a screen crashes, the person sees a plain message and the problem is reported to the platform admin. */
class Crash extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportProblem(Object.assign(error, { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` }));
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
        <p className="mt-2 text-sm text-ink-2">It has been reported so it can be fixed. Reload the page to carry on.</p>
        <button type="button" className="mt-4 min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white" onClick={() => window.location.assign('/')}>
          Reload
        </button>
      </div>
    );
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Crash>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/track/:token" element={page(<TrackPage />)} />
          <Route path="/" element={<RequireAuth>{<Home />}</RequireAuth>} />
          <Route path="/platform" element={<RequireAuth>{page(<Platform />)}</RequireAuth>} />
          <Route path="/driver/*" element={<RequireAuth>{page(<DriverApp />)}</RequireAuth>} />
          <Route path="/print/delivery/:id" element={<RequireAuth>{page(<PrintNote />)}</RequireAuth>} />
          <Route path="/app" element={<RequireAuth>{page(<AppLayout />)}</RequireAuth>}>
            <Route index element={page(<Deliveries />)} />
            <Route path="deliveries" element={<Navigate to="/app" replace />} />
            <Route path="deliveries/new" element={page(<DeliveryForm />)} />
            <Route path="deliveries/:id" element={page(<DeliveryDetail />)} />
            <Route path="deliveries/:id/edit" element={page(<DeliveryForm />)} />
            <Route path="customers" element={page(<Customers />)} />
            <Route path="vehicles" element={page(<Vehicles />)} />
            <Route path="money" element={page(<Money />)} />
            <Route path="reports" element={page(<Reports />)} />
            <Route path="team" element={page(<Team />)} />
            <Route path="settings" element={<Navigate to="costs" replace />} />
            <Route path="settings/:tab" element={page(<Settings />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Crash>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
