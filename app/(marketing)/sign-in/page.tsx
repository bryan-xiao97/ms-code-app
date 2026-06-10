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
