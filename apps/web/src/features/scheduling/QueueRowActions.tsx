import type { AppointmentSummary } from '@hospitalos/shared';
import { useNavigate } from 'react-router';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { useAction } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

/** Open the visit; a doctor starts or continues the consultation from here. */
export function QueueRowActions({ appointment: a }: { appointment: AppointmentSummary }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const start = useAction<object, { encounterId: string }>(
    'POST',
    `/api/appointments/${a.id}/encounter`,
    {
      invalidate: ['scheduling', '/api/encounters'],
      onSuccess: (res) => void navigate(`/encounters/${res.encounterId}`),
    },
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {can('encounter:write') && (a.status === 'checked_in' || a.status === 'in_consultation') && (
        <Button size="sm" disabled={start.pending} onClick={() => start.run({})}>
          {a.status === 'checked_in' ? 'Start consultation' : 'Continue'}
        </Button>
      )}
      <Button asChild size="sm" variant="secondary">
        <Link to={`/appointments/${a.id}`}>Open</Link>
      </Button>
      {start.error && <span className="text-xs text-red-700">{start.error}</span>}
    </div>
  );
}
