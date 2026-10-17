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

## Amendment (2026-10-17, implemented)
- **CSRF uses a synchronizer token, not double-submit.** A 256-bit token is created at login and stored in the server-side session. The SPA gets it from the login and `/api/auth/me` response bodies, keeps it in memory, and sends it in `X-CSRF-Token` on every `POST`, `PUT`, `PATCH` and `DELETE`. Nothing CSRF-related is in a cookie the page can read. Login itself has no session yet; it is protected by requiring a JSON body (which a cross-site form can't send) and by `SameSite=Lax`.
- **Lifetimes:** 30 minutes idle (rolling cookie and store expiry) and 12 hours absolute from login, checked on every request regardless of activity.
- **Cookie:** `hms.sid` in development; `__Host-hms.sid` in production, so the browser only accepts it with `Secure`, `Path=/` and no `Domain`.
- **Store:** `connect-pg-simple` on the `sessions` table (migration `0002`), through the API's `hms_app` pool. `hms_app` gets SELECT, INSERT, UPDATE and DELETE on `sessions` only (migration `0003`). The table is never auto-created.
- **Login failures:** one generic `401 INVALID_CREDENTIALS`; the reason is audited. Unknown usernames are verified against a dummy hash. Rate limit: 10 failed attempts per IP per 15 minutes (in memory; a shared store is needed before running more than one API instance).
- **Proxy trust:** `TRUST_PROXY` is `false` or 1–3 hops; `true` is rejected.
- **First administrator:** created by `npm run db:bootstrap-admin`, interactively, as `hms_app`, only while no SA holder exists. No credentials are hard-coded or seeded.
