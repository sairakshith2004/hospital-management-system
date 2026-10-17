import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

export function ForbiddenPage() {
  return (
    <Card className="space-y-3">
      <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Your role doesn&apos;t include this permission. Ask an administrator if you need it.
      </p>
      <Button asChild variant="secondary">
        <Link to="/">Go to home</Link>
      </Button>
    </Card>
  );
}
