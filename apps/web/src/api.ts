export type ApiHealth = 'online' | 'offline';

/** Calls GET /api/health (through the Vite proxy in development). Never throws. */
export async function checkApiHealth(timeoutMs = 5000): Promise<ApiHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 'offline';
    const body: unknown = await res.json();
    return isHealthy(body) ? 'online' : 'offline';
  } catch {
    return 'offline'; // network error, timeout or invalid JSON
  } finally {
    clearTimeout(timer);
  }
}

function isHealthy(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'ok'
  );
}
