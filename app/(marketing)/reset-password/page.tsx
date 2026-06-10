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
