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
