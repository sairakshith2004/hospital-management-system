import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { apiFetch, hasCsrfToken } from './lib/api';
import { CSRF, apiError, fakeApi, json, makeUser, renderApp, session } from './test-utils';

const signedOut = () => apiError(401, 'UNAUTHENTICATED', 'Authentication required');

async function fillAndSubmit(username: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('startup session check', () => {
  it('shows a spinner, then the login page when there is no session', async () => {
    fakeApi({ 'GET /api/auth/me': signedOut });
    const { router } = renderApp('/');
    expect(screen.getByText('Checking your session…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'HospitalOS' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(hasCsrfToken()).toBe(false);
  });

  it('remembers the requested page as ?next= when redirecting to login', async () => {
    fakeApi({ 'GET /api/auth/me': signedOut });
    const { router } = renderApp('/forbidden?x=1');
    await screen.findByLabelText('Username');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/forbidden?x=1')}`);
  });

  it('goes straight to the shell when the session is valid, holding the CSRF token in memory', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(200, session()) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Welcome, Test Receptionist' })).toBeTruthy();
    expect(screen.getByText('REC')).toBeTruthy();
    expect(hasCsrfToken()).toBe(true);
  });

  it('offers a retry when the server is unreachable, instead of signing out', async () => {
    let up = false;
    fakeApi({
      'GET /api/auth/me': () => {
        if (!up) throw new TypeError('Failed to fetch');
        return json(200, session());
      },
    });
    renderApp('/');
    expect(await screen.findByText(/Can't reach the server/, {}, { timeout: 3000 })).toBeTruthy();
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeTruthy();
  });
});

describe('login page (real API contract)', () => {
  it('posts JSON credentials, then opens the requested page', async () => {
    const api = fakeApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => json(200, session()),
    });
    const { router } = renderApp('/forbidden');
    await fillAndSubmit(' zz_reception ', 'synthetic-password');
    expect(await screen.findByRole('heading', { name: /don't have access/ })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/forbidden');

    const login = api.calls.find((c) => c.key === 'POST /api/auth/login')!;
    expect(JSON.parse(String(login.init.body))).toEqual({
      username: 'zz_reception',
      password: 'synthetic-password',
    });
    expect(login.init.credentials).toBe('same-origin');
    expect(new Headers(login.init.headers).get('Content-Type')).toBe('application/json');
    expect(hasCsrfToken()).toBe(true);
  });

  it('shows the generic message on 401 and clears the password', async () => {
    fakeApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password'),
    });
    renderApp('/login');
    await fillAndSubmit('zz_reception', 'wrong-password');
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid username or password.');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(hasCsrfToken()).toBe(false);
  });

  it('tells the user to wait on 429', async () => {
    fakeApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => apiError(429, 'RATE_LIMITED', 'Too many attempts.'),
    });
    renderApp('/login');
    await fillAndSubmit('zz_reception', 'x');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many attempts. Try again in a few minutes.',
    );
  });

  it('disables the form while signing in', async () => {
    let finish!: (r: Response) => void;
    fakeApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    renderApp('/login');
    await fillAndSubmit('zz_reception', 'synthetic-password');
    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Username') as HTMLInputElement).disabled).toBe(true);
    finish(json(200, session()));
    expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeTruthy();
  });

  it('ignores an off-site ?next= and goes home instead', async () => {
    fakeApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => json(200, session()),
    });
    const { router } = renderApp('/login?next=//evil.example/steal');
    await fillAndSubmit('zz_reception', 'synthetic-password');
    await screen.findByRole('heading', { name: /Welcome/ });
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('signed-in shell', () => {
  it('signs out with the CSRF token, drops the session and returns to login', async () => {
    const api = fakeApi({
      'GET /api/auth/me': () => json(200, session()),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const { router } = renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('You have signed out.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(api.headersOf('POST /api/auth/logout')[0]?.get('X-CSRF-Token')).toBe(CSRF);
    expect(api.headersOf('GET /api/auth/me')[0]?.get('X-CSRF-Token')).toBeNull();
    expect(hasCsrfToken()).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('finishes signing out locally when the server session had already ended (401)', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(200, session()),
      'POST /api/auth/logout': signedOut,
    });
    const { router } = renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('tells an account without roles that it is waiting for an assignment (AD-8)', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(200, session(makeUser({ roles: [], permissions: [] }))),
    });
    renderApp('/');
    expect(await screen.findByText(/waiting for a role assignment/)).toBeTruthy();
    expect(screen.getByText('No role assigned')).toBeTruthy();
  });

  it('shows a 404 page inside the shell for unknown paths', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(200, session()) });
    renderApp('/no-such-page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('sends the user to login with a "session ended" notice when the server ends the session', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(200, session()),
      'GET /api/anything': signedOut,
    });
    const { router } = renderApp('/forbidden');
    await screen.findByRole('heading', { name: /don't have access/ });
    await act(async () => {
      await apiFetch('/api/anything').catch(() => undefined);
    });
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/forbidden');
    expect(hasCsrfToken()).toBe(false);
  });

  it('sends an already signed-in user away from /login', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(200, session()) });
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { name: /Welcome/ });
    expect(router.state.location.pathname).toBe('/');
  });
});
