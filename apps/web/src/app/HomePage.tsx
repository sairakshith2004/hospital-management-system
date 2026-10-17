import { Card } from '../components/ui/card';
import { useAuth } from '../features/auth/auth-context';

export function HomePage() {
  const { user } = useAuth();
  if (!user) return null;
  const awaitingRole = user.roles.length === 0;
  return (
    <Card className="space-y-2">
      <h1 className="text-xl font-semibold">Welcome, {user.fullName}</h1>
      {awaitingRole ? (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Your account is waiting for a role assignment. An administrator will give you access to
          the parts of HospitalOS you need.
        </p>
      ) : (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Signed in as <span className="font-medium">{user.username}</span> with the role
          {user.roles.length > 1 ? 's' : ''} {user.roles.join(', ')} ({user.permissions.length}{' '}
          permissions).
        </p>
      )}
    </Card>
  );
}
