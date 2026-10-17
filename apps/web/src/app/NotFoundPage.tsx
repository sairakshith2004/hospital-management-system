import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

export function NotFoundPage() {
  return (
    <Card className="space-y-3">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        This page doesn&apos;t exist, or isn&apos;t available yet.
      </p>
      <Button asChild variant="secondary">
        <Link to="/">Go to home</Link>
      </Button>
    </Card>
  );
}
