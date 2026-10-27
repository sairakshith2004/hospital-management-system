import { Navigate, Outlet, useLocation } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { PageSpinner } from '../../components/ui/spinner';
import { CommHub } from '../communication/CommHub';
import { useAuth } from './auth-context';

/** Guards every page except /login. UX only: the API enforces access on every request. */
export function RequireAuth() {
  const { status, endReason, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageSpinner label="Checking your session…" />;
  if (status === 'unreachable') {
    return (
      <div className="mx-auto mt-24 max-w-md space-y-4 px-4">
        <Alert tone="error">Can&apos;t reach the server. Check the connection and try again.</Alert>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (status === 'signedOut') {
    const params = new URLSearchParams();
    const here = `${location.pathname}${location.search}`;
    if (endReason === 'signedOut') params.set('signedOut', '1');
    else if (here !== '/') params.set('next', here);
    if (endReason === 'expired') params.set('expired', '1');
    const query = params.toString();
    return <Navigate to={`/login${query ? `?${query}` : ''}`} replace />;
  }
  // The communication hub's chat button floats over every signed-in page, portals included.
  return (
    <>
      <Outlet />
      <CommHub />
    </>
  );
}
