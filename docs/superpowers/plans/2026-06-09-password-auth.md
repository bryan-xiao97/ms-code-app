# Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace magic-link sign-in with email + password authentication — self-service sign-up with required email confirmation, password sign-in, and a forgot/reset password flow.

**Architecture:** Next.js 16 Server Actions in the `app/(marketing)/` route group call Supabase Auth (`signUp`, `signInWithPassword`, `resetPasswordForEmail`, `updateUser`). Pages are client components using the repo's existing `Button` / `Input` / `Surface` primitives. Email confirmation and password-recovery links route through the existing `app/auth/callback/route.ts`, which exchanges the code for a session. Pure validation logic lives in a unit-tested `lib/auth/` helper.

**Tech Stack:** Next.js 16 App Router (TypeScript strict), Supabase Auth via `@supabase/ssr`, Tailwind 4, Vitest (unit), Playwright + Mailpit (e2e).

**Spec:** `docs/superpowers/specs/2026-06-09-password-auth-design.md`

---

## File structure

**New files:**
- `lib/auth/validation.ts` — pure validation functions + shared `AuthResult` type.
- `lib/auth/safe-next.ts` — open-redirect-safe `next` path sanitizer (shared by sign-in action + callback).
- `app/(marketing)/sign-up/page.tsx` + `actions.ts` — self-service registration.
- `app/(marketing)/forgot-password/page.tsx` + `actions.ts` — request a reset email.
- `app/(marketing)/reset-password/page.tsx` + `actions.ts` — set a new password from a recovery link.
- `tests/unit/auth-validation.test.ts` — unit tests for `validation.ts` and `safe-next.ts`.
- `tests/e2e/helpers/auth.ts` — `registerAndSignIn()` helper used by e2e specs.

**Modified files:**
- `app/(marketing)/sign-in/actions.ts` — `signInWithMagicLink` → `signInWithPassword`.
- `app/(marketing)/sign-in/page.tsx` — add password field, `next` passthrough, nav links.
- `app/auth/callback/route.ts` — use `safeNext`; route `type=recovery` links to `/reset-password`.
- `middleware.ts` — add new public paths.
- `supabase/config.toml` — `enable_confirmations = true`, `minimum_password_length = 8`.
- `tests/e2e/helpers/inbucket.ts` — rename `getMagicLink` → `getConfirmationLink`.
- `tests/e2e/auth.spec.ts` — rewrite for password flows.
- `tests/e2e/deal-pm.spec.ts`, `tests/e2e/dd-qa.spec.ts` — sign in via `registerAndSignIn`.
- `CLAUDE.md` — sync Module map + auth description.

---

## Task 1: Supabase auth config

Turn on email confirmation and raise the minimum password length. These are local-dev settings; production (hosted Supabase) must be set to match in the dashboard, noted at the end.

**Files:**
- Modify: `supabase/config.toml`

- [ ] **Step 1: Enable email confirmations**

In `supabase/config.toml`, under `[auth.email]`, change:

```toml
enable_confirmations = false
```
to:
```toml
enable_confirmations = true
```

- [ ] **Step 2: Raise minimum password length**

In `supabase/config.toml`, under `[auth]`, change:

```toml
minimum_password_length = 6
```
to:
```toml
minimum_password_length = 8
```

- [ ] **Step 3: Apply the config to the running stack**

Run: `pnpm supabase:stop && pnpm supabase:start`
Expected: Supabase restarts cleanly and prints the local API URL / keys.

(If the stack is not currently running, `pnpm supabase:start` alone is fine.)

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml
git commit -m "chore(auth): require email confirmation, min password length 8"
```

---

## Task 2: Validation helper (TDD)

Pure functions, no Supabase — perfect for fast unit tests. Defines the `AuthResult` type reused by every auth action.

**Files:**
- Create: `lib/auth/validation.ts`
- Test: `tests/unit/auth-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateEmail,
  validatePassword,
  passwordsMatch,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/validation";

describe("validateEmail", () => {
  it("returns null for a valid address", () => {
    expect(validateEmail("a@b.com")).toBeNull();
  });
  it("returns an error for a missing @", () => {
    expect(validateEmail("nope")).toBe("Enter a valid email address.");
  });
  it("returns an error for an empty string", () => {
    expect(validateEmail("")).toBe("Enter a valid email address.");
  });
});

describe("validatePassword", () => {
  it("returns null when length >= minimum", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });
  it("returns an error when too short", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  });
});

describe("passwordsMatch", () => {
  it("is true when equal", () => {
    expect(passwordsMatch("abc", "abc")).toBe(true);
  });
  it("is false when different", () => {
    expect(passwordsMatch("abc", "abd")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/auth-validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/validation`.

- [ ] **Step 3: Write the implementation**

Create `lib/auth/validation.ts`:

```ts
export type AuthResult = { ok: true } | { ok: false; error: string };

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Returns an error message, or null if the email is well-formed. */
export function validateEmail(email: string): string | null {
  if (!email || !EMAIL_RE.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

/** Returns an error message, or null if the password meets the length policy. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function passwordsMatch(password: string, confirm: string): boolean {
  return password === confirm;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/auth-validation.test.ts`
Expected: PASS — all 7 assertions green.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/validation.ts tests/unit/auth-validation.test.ts
git commit -m "feat(auth): add credential validation helper"
```

---

## Task 3: safeNext redirect helper (TDD)

Extract the open-redirect guard currently inlined in the callback route so the sign-in action can reuse it.

**Files:**
- Create: `lib/auth/safe-next.ts`
- Test: `tests/unit/auth-validation.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Add to `tests/unit/auth-validation.test.ts`:

```ts
import { safeNext } from "@/lib/auth/safe-next";

describe("safeNext", () => {
  it("allows an app-relative path", () => {
    expect(safeNext("/deals/123")).toBe("/deals/123");
  });
  it("falls back on null", () => {
    expect(safeNext(null)).toBe("/deals");
  });
  it("rejects a protocol-relative path", () => {
    expect(safeNext("//evil.com")).toBe("/deals");
  });
  it("rejects a backslash-smuggled path", () => {
    expect(safeNext("/\\evil.com")).toBe("/deals");
  });
  it("honours a custom fallback", () => {
    expect(safeNext(null, "/sign-in")).toBe("/sign-in");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/auth-validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/safe-next`.

- [ ] **Step 3: Write the implementation**

Create `lib/auth/safe-next.ts`:

```ts
/**
 * Returns a safe app-relative redirect target. Only allows paths that start with
 * a single "/" and are not protocol-relative ("//") or backslash-smuggled ("/\").
 */
export function safeNext(raw: string | null, fallback = "/deals"): string {
  const next = raw ?? fallback;
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    return next;
  }
  return fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/auth-validation.test.ts`
Expected: PASS — all assertions green (12 total now).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/safe-next.ts tests/unit/auth-validation.test.ts
git commit -m "feat(auth): add safeNext redirect guard"
```

---

## Task 4: Callback route — recovery routing + shared safeNext

Confirmation links land here already. Add password-recovery routing and reuse the extracted `safeNext`.

**Files:**
- Modify: `app/auth/callback/route.ts`

- [ ] **Step 1: Replace the route file**

Replace the entire contents of `app/auth/callback/route.ts` with:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  // Recovery links must land on the set-new-password page; everything else
  // (email confirmation, future flows) honours the validated `next` param.
  const next = type === "recovery" ? "/reset-password" : safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/sign-in?error=callback`);
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/auth/callback/route.ts
git commit -m "feat(auth): route recovery links to reset-password in callback"
```

---

## Task 5: Middleware — new public paths

Allow the new auth pages through without a session.

**Files:**
- Modify: `middleware.ts`

- [ ] **Step 1: Extend PUBLIC_PATHS**

In `middleware.ts`, replace:

```ts
const PUBLIC_PATHS = ["/sign-in", "/auth/callback", "/api/health", "/api/inngest"];
```
with:
```ts
const PUBLIC_PATHS = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/api/health",
  "/api/inngest",
];
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): allow sign-up and password-reset routes through middleware"
```

---

## Task 6: Sign-in with password

Swap the OTP call for `signInWithPassword`, redirect on success with a generic error on failure.

**Files:**
- Modify: `app/(marketing)/sign-in/actions.ts`
- Modify: `app/(marketing)/sign-in/page.tsx`

- [ ] **Step 1: Replace the sign-in action**

Replace the entire contents of `app/(marketing)/sign-in/actions.ts` with:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateEmail, type AuthResult } from "@/lib/auth/validation";
import { safeNext } from "@/lib/auth/safe-next";

export type SignInResult = AuthResult;

export async function signInWithPassword(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/deals"));

  const emailErr = validateEmail(email);
  if (emailErr) return { ok: false, error: emailErr };
  if (!password) return { ok: false, error: "Enter your password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Generic message — do not reveal whether the email exists.
    return { ok: false, error: "Invalid email or password." };
  }

  redirect(next);
}
```

- [ ] **Step 2: Replace the sign-in page**

Replace the entire contents of `app/(marketing)/sign-in/page.tsx` with:

```tsx
"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { signInWithPassword } from "./actions";

function SignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/deals";
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await signInWithPassword(formData);
      // On success the action redirects; we only handle the failure branch.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Surface className="w-full max-w-sm p-8">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">
        Enter your email and password to continue.
      </p>
      <form action={onSubmit} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
            Email
          </label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in..." : "Sign in"}
        </Button>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-indigo-600 hover:underline">
          Forgot password?
        </Link>
        <Link href="/sign-up" className="text-indigo-600 hover:underline">
          Create account
        </Link>
      </div>
    </Surface>
  );
}

export default function SignInPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS — no type or lint errors.

- [ ] **Step 4: Manual smoke (requires Supabase running + `pnpm dev`)**

Visit `http://localhost:3000/sign-in`, sign in with the seeded user
`demo@local.test` / `demo-password-12345`.
Expected: redirected to `/deals`, "Project Atlas" visible. A wrong password shows
"Invalid email or password." and stays on `/sign-in`.

- [ ] **Step 5: Commit**

```bash
git add "app/(marketing)/sign-in/actions.ts" "app/(marketing)/sign-in/page.tsx"
git commit -m "feat(auth): sign in with email and password"
```

---

## Task 7: Self-service sign-up

Register with email + password; with confirmations on, Supabase emails a link and
returns no session, so the page tells the user to check their email.

**Files:**
- Create: `app/(marketing)/sign-up/actions.ts`
- Create: `app/(marketing)/sign-up/page.tsx`

- [ ] **Step 1: Write the sign-up action**

Create `app/(marketing)/sign-up/actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  validateEmail,
  validatePassword,
  passwordsMatch,
  type AuthResult,
} from "@/lib/auth/validation";

export type SignUpResult = AuthResult;

export async function signUp(formData: FormData): Promise<SignUpResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const emailErr = validateEmail(email);
  if (emailErr) return { ok: false, error: emailErr };
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };
  if (!passwordsMatch(password, confirm)) {
    return { ok: false, error: "Passwords do not match." };
  }

  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Write the sign-up page**

Create `app/(marketing)/sign-up/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { signUp } from "./actions";

export default function SignUpPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await signUp(formData);
      if (result.ok) {
        setMessage("Check your email to confirm your account, then sign in.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <Surface className="w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Create account</h1>
        <p className="text-sm text-slate-500 mb-6">
          Sign up with your email and a password.
        </p>
        <form action={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-slate-700 mb-1">
              Confirm password
            </label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creating..." : "Create account"}
          </Button>
          {message && <p className="text-sm text-emerald-600">{message}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>
        <div className="mt-4 text-sm">
          <Link href="/sign-in" className="text-indigo-600 hover:underline">
            Already have an account? Sign in
          </Link>
        </div>
      </Surface>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke (Supabase + `pnpm dev` running)**

Visit `/sign-up`, register a fresh email with a matching 8+ char password.
Expected: "Check your email to confirm your account" appears. Open Mailpit at
`http://localhost:54324`, click the confirmation link → lands on `/deals`.

- [ ] **Step 5: Commit**

```bash
git add "app/(marketing)/sign-up"
git commit -m "feat(auth): self-service sign-up with email confirmation"
```

---

## Task 8: Forgot password (request reset)

Send a recovery email. Always report success to avoid account enumeration.

**Files:**
- Create: `app/(marketing)/forgot-password/actions.ts`
- Create: `app/(marketing)/forgot-password/page.tsx`

- [ ] **Step 1: Write the action**

Create `app/(marketing)/forgot-password/actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { validateEmail, type AuthResult } from "@/lib/auth/validation";

export type ForgotPasswordResult = AuthResult;

export async function requestPasswordReset(
  formData: FormData
): Promise<ForgotPasswordResult> {
  const email = String(formData.get("email") ?? "").trim();
  const emailErr = validateEmail(email);
  if (emailErr) return { ok: false, error: emailErr };

  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?type=recovery`,
  });
  // Always succeed — do not reveal whether the email is registered.
  return { ok: true };
}
```

- [ ] **Step 2: Write the page**

Create `app/(marketing)/forgot-password/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { requestPasswordReset } from "./actions";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await requestPasswordReset(formData);
      if (result.ok) {
        setMessage("If that email exists, we've sent a password reset link.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <Surface className="w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Reset password</h1>
        <p className="text-sm text-slate-500 mb-6">
          Enter your email and we&apos;ll send you a reset link.
        </p>
        <form action={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending..." : "Send reset link"}
          </Button>
          {message && <p className="text-sm text-emerald-600">{message}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>
        <div className="mt-4 text-sm">
          <Link href="/sign-in" className="text-indigo-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      </Surface>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(marketing)/forgot-password"
git commit -m "feat(auth): forgot-password request flow"
```

---

## Task 9: Reset password (set new password)

The recovery link lands on `/auth/callback?type=recovery`, which exchanges the code
into a session and redirects here. The user is authenticated at this point and just
sets a new password.

**Files:**
- Create: `app/(marketing)/reset-password/actions.ts`
- Create: `app/(marketing)/reset-password/page.tsx`

- [ ] **Step 1: Write the action**

Create `app/(marketing)/reset-password/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePassword, passwordsMatch, type AuthResult } from "@/lib/auth/validation";

export type ResetPasswordResult = AuthResult;

export async function updatePassword(formData: FormData): Promise<ResetPasswordResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };
  if (!passwordsMatch(password, confirm)) {
    return { ok: false, error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { ok: false, error: "Reset link is invalid or expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: error.message };
  }

  redirect("/deals");
}
```

- [ ] **Step 2: Write the page**

Create `app/(marketing)/reset-password/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { updatePassword } from "./actions";

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updatePassword(formData);
      // On success the action redirects; we only handle the failure branch.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <Surface className="w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Set a new password</h1>
        <p className="text-sm text-slate-500 mb-6">Choose a new password for your account.</p>
        <form action={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              New password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-slate-700 mb-1">
              Confirm password
            </label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving..." : "Save password"}
          </Button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>
      </Surface>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke (Supabase + `pnpm dev` running)**

From `/forgot-password`, request a reset for `demo@local.test`. Open Mailpit
(`http://localhost:54324`), click the reset link → lands on `/reset-password`.
Set a new 8+ char password → redirected to `/deals`. Sign out, then sign in with the
new password to confirm it took.
(Re-seed afterwards with `pnpm supabase:reset` so the demo password returns to its
seed value.)

- [ ] **Step 5: Commit**

```bash
git add "app/(marketing)/reset-password"
git commit -m "feat(auth): reset-password set-new-password flow"
```

---

## Task 10: E2E helpers — rename + shared sign-up helper

`getMagicLink` no longer describes what it fetches (it now pulls confirmation /
recovery links). Rename it, and add a reusable register-and-confirm helper for the
deal/QA specs that previously relied on magic-link auto-provisioning.

**Files:**
- Modify: `tests/e2e/helpers/inbucket.ts`
- Create: `tests/e2e/helpers/auth.ts`

- [ ] **Step 1: Rename the mail helper**

In `tests/e2e/helpers/inbucket.ts`, rename the exported function `getMagicLink` to
`getConfirmationLink`. Change only the function signature line:

```ts
export async function getConfirmationLink(email: string): Promise<string> {
```
Leave the body unchanged. Update the trailing throw message:

```ts
  throw new Error(`No confirmation link arrived for ${email} in 10s`);
```

- [ ] **Step 2: Create the register-and-sign-in helper**

Create `tests/e2e/helpers/auth.ts`:

```ts
import type { Page } from "@playwright/test";
import { getConfirmationLink } from "./inbucket";

/**
 * Registers a brand-new account, confirms it via the Mailpit link, and lands the
 * page on /deals. Used by e2e specs that need an authenticated, empty workspace.
 */
export async function registerAndSignIn(
  page: Page,
  email: string,
  password = "e2e-password-123"
): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  const link = await getConfirmationLink(email);
  await page.goto(link);
  await page.waitForURL(/\/deals$/, { timeout: 15_000 });
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. (Specs still importing `getMagicLink` are fixed in Tasks 11–12;
if you run tsc before those, expect references to resolve only after they're updated.
Proceed to Task 11 next.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/inbucket.ts tests/e2e/helpers/auth.ts
git commit -m "test(auth): rename mail helper, add registerAndSignIn helper"
```

---

## Task 11: Rewrite the auth e2e spec

**Files:**
- Modify: `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Replace the spec**

Replace the entire contents of `tests/e2e/auth.spec.ts` with:

```ts
import { test, expect } from "@playwright/test";
import { getConfirmationLink, clearInbucket } from "./helpers/inbucket";

test.beforeEach(async () => {
  await clearInbucket();
});

test("new user can sign up, confirm email, and reach /deals", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`;
  const password = "e2e-password-123";

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  const link = await getConfirmationLink(email);
  await page.goto(link);

  await expect(page).toHaveURL(/\/deals$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(page.getByText("No deals yet.")).toBeVisible();
});

test("seeded demo user can sign in with a password", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@local.test");
  await page.getByLabel("Password", { exact: true }).fill("demo-password-12345");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page).toHaveURL(/\/deals$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
});

test("wrong password shows a generic error and stays on /sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@local.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});
```

- [ ] **Step 2: Run the auth e2e spec (Supabase + Mailpit running)**

Run: `pnpm e2e tests/e2e/auth.spec.ts`
Expected: 3 passed. (Playwright starts the dev server itself per `playwright.config.ts`.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/auth.spec.ts
git commit -m "test(auth): cover sign-up, password sign-in, and bad-password paths"
```

---

## Task 12: Migrate deal-pm and dd-qa e2e specs

Both currently sign in via the removed magic-link button. Switch them to
`registerAndSignIn`.

**Files:**
- Modify: `tests/e2e/deal-pm.spec.ts`
- Modify: `tests/e2e/dd-qa.spec.ts`

- [ ] **Step 1: Update `deal-pm.spec.ts` imports and sign-in**

In `tests/e2e/deal-pm.spec.ts`, replace the import line:

```ts
import { getMagicLink, clearInbucket } from "./helpers/inbucket";
```
with:
```ts
import { clearInbucket } from "./helpers/inbucket";
import { registerAndSignIn } from "./helpers/auth";
```

Then replace this block:

```ts
  const email = `pm-${Date.now()}@test.local`;

  // Sign in
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  const link = await getMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/deals$/);
```
with:
```ts
  const email = `pm-${Date.now()}@test.local`;

  // Register, confirm, and land on /deals
  await registerAndSignIn(page, email);
```

- [ ] **Step 2: Update `dd-qa.spec.ts` imports and sign-in**

In `tests/e2e/dd-qa.spec.ts`, replace the import line:

```ts
import { getMagicLink, clearInbucket } from "./helpers/inbucket";
```
with:
```ts
import { clearInbucket } from "./helpers/inbucket";
import { registerAndSignIn } from "./helpers/auth";
```

Then replace this block:

```ts
  const email = `qa-${Date.now()}@test.local`;

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  const link = await getMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/deals$/);
```
with:
```ts
  const email = `qa-${Date.now()}@test.local`;

  await registerAndSignIn(page, email);
```

- [ ] **Step 3: Verify no magic-link references remain**

Run: `grep -rn "getMagicLink\|send magic link\|signInWithOtp\|signInWithMagicLink" app lib tests middleware.ts`
Expected: no output (empty result).

- [ ] **Step 4: Run the deal-pm e2e spec**

Run: `pnpm e2e tests/e2e/deal-pm.spec.ts`
Expected: 1 passed.

(The dd-qa spec self-skips without `GEMINI_API_KEY`; run it only if a key is present.)

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/deal-pm.spec.ts tests/e2e/dd-qa.spec.ts
git commit -m "test(auth): migrate deal-pm and dd-qa specs to password sign-up"
```

---

## Task 13: Docs sync + full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Module map auth bullet**

In `CLAUDE.md`, in the "Module map and build phases" section, replace the auth/sign-in
description to reflect the new routes. Change the `lib/auth.ts` line's neighbourhood by
adding a routes line. Specifically, under the module map list, replace:

```
- `lib/auth.ts` — `requireUser()` helper used by protected layouts.
```
with:
```
- `lib/auth.ts` — `requireUser()` helper used by protected layouts; `lib/auth/validation.ts` + `lib/auth/safe-next.ts` — auth input validation and redirect guard.
- `app/(marketing)/sign-in`, `sign-up`, `forgot-password`, `reset-password` — email + password auth pages and their server actions; `app/auth/callback/route.ts` handles email-confirmation and password-recovery links.
```

- [ ] **Step 2: Update the Auth stack-constraint line**

In `CLAUDE.md`, under "Stack constraints", replace:

```
- Auth: Supabase Auth (email magic link). Middleware in `middleware.ts` redirects unauthenticated users to `/sign-in`.
```
with:
```
- Auth: Supabase Auth (email + password with self-service sign-up and required email confirmation). Middleware in `middleware.ts` redirects unauthenticated users to `/sign-in`.
```

- [ ] **Step 3: Run the full unit/integration suite**

Run: `pnpm test`
Expected: PASS — all unit + integration tests green (requires local Supabase running
for the integration tests).

- [ ] **Step 4: Type-check and lint the whole project**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS — no errors.

- [ ] **Step 5: Run the full e2e suite**

Run: `pnpm e2e`
Expected: auth + deal-pm specs pass; dd-qa skips without `GEMINI_API_KEY`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: sync CLAUDE.md for password auth"
```

---

## Production / hosted Supabase note

The `supabase/config.toml` changes apply to **local dev** only. Before shipping,
set the matching values in the hosted Supabase project dashboard:

- **Authentication → Providers → Email:** enable "Confirm email".
- **Authentication → Policies / Password:** minimum length 8.
- **Authentication → URL Configuration:** ensure the site URL and
  `*/auth/callback` redirect URL are allow-listed for the deployed origin.

No data migration is required — `auth.users` already stores password hashes, and the
seeded demo user is already confirmed.

---

## Self-review notes

- **Spec coverage:** sign-up (Task 7), email confirmation (Tasks 1 + 4 + 7), password
  sign-in (Task 6), forgot (Task 8), reset (Task 9), config (Task 1), middleware
  (Task 5), validation helper (Task 2), tests (Tasks 11–12), removal of magic link
  (Tasks 6 + 12, verified by grep in Task 12 Step 3), docs (Task 13). All spec sections
  map to a task.
- **Type consistency:** `AuthResult` is defined once in `lib/auth/validation.ts` and
  re-exported as `SignInResult` / `SignUpResult` / `ForgotPasswordResult` /
  `ResetPasswordResult`. `safeNext(raw, fallback?)` and the validation function
  signatures match every call site. The e2e helper is `registerAndSignIn` everywhere;
  the mail helper is `getConfirmationLink` everywhere.
