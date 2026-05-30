"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { signInWithMagicLink } from "./actions";

export default function SignInPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await signInWithMagicLink(formData);
      if (result.ok) {
        setMessage("Check your email for the sign-in link.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <Surface className="w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Sign in</h1>
        <p className="text-sm text-slate-500 mb-6">
          We&apos;ll email you a one-click sign-in link.
        </p>
        <form action={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending..." : "Send magic link"}
          </Button>
          {message && <p className="text-sm text-emerald-600">{message}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>
      </Surface>
    </main>
  );
}
