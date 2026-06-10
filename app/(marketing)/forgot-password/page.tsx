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
