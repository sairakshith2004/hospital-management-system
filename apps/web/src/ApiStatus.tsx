import { useCallback, useEffect, useState } from 'react';
import { checkApiHealth } from './api';

type Status = 'checking' | 'online' | 'offline';

const LABELS: Record<Status, string> = {
  checking: 'Checking API…',
  online: 'API online',
  offline: 'API unreachable',
};

export function ApiStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let active = true;
    void checkApiHealth().then((result) => {
      if (active) setStatus(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const recheck = useCallback(async () => {
    setStatus('checking');
    setStatus(await checkApiHealth());
  }, []);

  return (
    <section className="card" aria-labelledby="api-status-heading">
      <h2 id="api-status-heading">System status</h2>
      <p role="status" aria-live="polite" className={`status status-${status}`}>
        <span className="status-dot" aria-hidden="true" /> {LABELS[status]}
      </p>
      <button type="button" onClick={() => void recheck()} disabled={status === 'checking'}>
        Check again
      </button>
    </section>
  );
}
