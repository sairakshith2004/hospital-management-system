# ADR 0004: Server-side session authentication

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
Staff accounts give access to medical, financial and employee data. When an employee leaves or an account is compromised, access must end immediately.

## Decision
- Sessions are stored in PostgreSQL (`express-session` with a Postgres store).
- The session cookie is `httpOnly`, `Secure` (in production) and `SameSite=Lax`, with a rolling expiry.
- Passwords are hashed with argon2id.
- Five failed logins lock the account for 15 minutes.
- CSRF protection uses a double-submit token, sent as the `X-CSRF-Token` header on every request that changes data.
- Every request reloads the user and rejects any account that isn't `active`.
- The session ID is regenerated at login and destroyed at logout.
- Login is rate-limited.

## Alternatives considered
- **JWT access and refresh tokens.** Revoking them needs a denylist, and storing them in the browser raises XSS and CSRF trade-offs.
- **Better Auth or a similar library.** Less code to own, but less of it can be explained line by line in an interview.

## Consequences
- Access can be revoked instantly by deleting the session or disabling the user.
- One database lookup per request, which is acceptable at around 50 concurrent users.
- The SPA and API must be served from the same site, or the cookie and CORS settings must be configured correctly (checked during the Day 5 deployment spike).
