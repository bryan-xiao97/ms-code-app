# Password Authentication with Self-Service Sign-Up

**Date:** 2026-06-09
**Status:** Approved design — ready for implementation planning

## Summary

Replace the current magic-link (passwordless OTP) sign-in with email + password
authentication. Add self-service sign-up with email confirmation, password sign-in,
and a forgot/reset password flow. Magic link is fully replaced, not retained as a
fallback.

The result is self-sufficient auth: a new user can register, confirm their email,
sign in, and recover a forgotten password with no admin intervention.

## Current state (what we're replacing)

- `app/(marketing)/sign-in/actions.ts` — `signInWithMagicLink` calls
  `supabase.auth.signInWithOtp({ email })`, emailing a one-click link.
- `app/(marketing)/sign-in/page.tsx` — single email field; copy reads
  "We'll email you a one-click sign-in link" / "Send magic link".
- `app/auth/callback/route.ts` — `exchangeCodeForSession(code)` (PKCE), then
  redirects to `next ?? /deals`.
- `middleware.ts` — gates protected routes; `/sign-in` and `/auth/callback` are public.
- `lib/auth.ts` — `requireUser()` helper (unchanged by this work).
- No sign-up flow exists; magic link auto-provisions any email that asks.
- `supabase/seed.sql` — demo user already has a bcrypt password
  (`demo-password-12345`) and `email_confirmed_at = now()`.
- `tests/e2e/auth.spec.ts` — drives the magic-link flow via Mailpit
  (`tests/e2e/helpers/inbucket.ts`).
- `supabase/config.toml` — `[auth.email] enable_confirmations = false`,
  `minimum_password_length = 6`, `enable_signup = true`.

## Decisions

| Decision | Choice |
|---|---|
| Account provisioning | Self-service sign-up (public registration page) |
| Email confirmation | Required before first login |
| Forgot/reset password | Included |
| Implementation style | Server Actions + existing custom UI primitives |
| Password policy | Length only, minimum 8 characters (no symbol/case rules) |
| Magic link | Removed entirely (not kept as fallback) |

### Why Server Actions + custom UI

This mirrors the existing `signInWithMagicLink` action exactly: pages stay client
components using the repo's `Button` / `Input` / `Surface` primitives, and the
server-side cookie handling stays consistent with the rest of the app. Rejected
alternatives: direct client-side Supabase calls (diverges from the established
server-action pattern) and `@supabase/auth-ui-react` (heavy dependency that fights
the hand-rolled UI primitives the repo deliberately uses).

## Architecture

### Routes & files

New pages under `app/(marketing)/` (all public):

- `sign-up/page.tsx` + `sign-up/actions.ts` — register with email + password.
- `forgot-password/page.tsx` + `forgot-password/actions.ts` — request a reset email.
- `reset-password/page.tsx` + `reset-password/actions.ts` — set a new password,
  reached from the emailed recovery link.

Changed:

- `sign-in/page.tsx` — add a password field plus "Forgot password?" and
  "Create account" links; replace magic-link copy.
- `sign-in/actions.ts` — `signInWithMagicLink` → `signInWithPassword({ email, password })`.
- `auth/callback/route.ts` — keep `exchangeCodeForSession`; additionally route
  recovery links (via a `type=recovery` query param) to `/reset-password` instead
  of `/deals`.
- `middleware.ts` — add `/sign-up`, `/forgot-password`, `/reset-password` to
  `PUBLIC_PATHS`.
- `lib/auth.ts` — unchanged.

New shared helper:

- `lib/auth/validation.ts` — email shape, password length (≥ 8), and
  confirm-password match. Server actions are the source of truth; client does light
  pre-checks for UX only.

### The four flows

**Sign-up.** Action validates input, then
`supabase.auth.signUp({ email, password, options: { emailRedirectTo: ${origin}/auth/callback } })`.
With email confirmation on, no session is returned; the page shows
"Check your email to confirm." The confirmation link hits `/auth/callback` →
`exchangeCodeForSession` → redirect to `/deals`.

**Sign-in.** `supabase.auth.signInWithPassword({ email, password })`. On success the
session cookie is set server-side; redirect to `next ?? /deals`. On failure, show a
deliberately generic "Invalid email or password" (do not reveal which field was wrong).

**Forgot password.** `supabase.auth.resetPasswordForEmail(email, { redirectTo: ${origin}/auth/callback?type=recovery })`.
Always respond with "If that email exists, we sent a reset link" — no account
enumeration.

**Reset password.** The callback exchanges the recovery code into a session and
redirects to `/reset-password`. That page calls
`supabase.auth.updateUser({ password })`, then redirects to `/deals`.

### Security notes

- Generic error/response messages on sign-in and forgot-password paths to prevent
  account enumeration.
- Confirmation required before first login prevents typo/fake-email accounts.
- Password validation enforced server-side in the actions, not just client-side.

## Configuration changes (`supabase/config.toml`)

- `[auth.email] enable_confirmations = false → true`.
- `minimum_password_length = 6 → 8`.
- Keep `email_sent = 100` rate-limit override; it now covers confirmation/reset
  emails instead of magic links. Update the explanatory comment accordingly.

## Testing

- Rewrite `tests/e2e/auth.spec.ts`:
  - Sign-up → pull the confirmation link from Mailpit → land on `/deals`.
  - Sign-in with the seeded demo user (already confirmed, has a password) → `/deals`.
  - Wrong password → generic error, stays on `/sign-in`.
  - Optional: full reset flow (request → recovery link → set new password → signed in).
- The Mailpit helper (`tests/e2e/helpers/inbucket.ts`) still works; it now pulls
  confirmation/recovery links rather than magic links. Rename conceptually if desired.
- `supabase/seed.sql` needs no change — the demo user is already confirmed and has a
  password, so it supports the password sign-in test directly.

## Removed

- `signInWithOtp` call and all magic-link UI copy ("Send magic link",
  "We'll email you a one-click sign-in link").
- Magic link is replaced entirely; it is not offered as an alternate sign-in method.

## Out of scope

- Symbol/case password complexity rules (`password_requirements` stays empty).
- OAuth / social providers, SSO, MFA.
- Admin-driven invite provisioning (self-service sign-up is the chosen path).
- Rate-limiting changes beyond the existing local/CI override.
