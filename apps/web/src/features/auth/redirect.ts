/**
 * Where to go after login. Only same-app paths are allowed, so a crafted link like
 * /login?next=//evil.example can't send a user to another site after signing in.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/';
  }
  return next;
}
