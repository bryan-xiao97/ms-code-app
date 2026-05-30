"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { createDeal } from "@/app/(app)/deals/actions";

export function CreateDealForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createDeal(formData);
      if (!result.ok) setError(result.error);
      // On success the action calls redirect() and this branch never runs.
    });
  }

  return (
    <Surface className="p-5 mb-8">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">New deal</h2>
      <form action={onSubmit} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-slate-600 mb-1">
            Deal name
          </label>
          <Input id="name" name="name" required maxLength={120} />
        </div>
        <div>
          <label htmlFor="target_company" className="block text-xs font-medium text-slate-600 mb-1">
            Target company
          </label>
          <Input id="target_company" name="target_company" required maxLength={120} />
        </div>
        <div>
          <label htmlFor="sector" className="block text-xs font-medium text-slate-600 mb-1">
            Sector (optional)
          </label>
          <Input id="sector" name="sector" maxLength={80} />
        </div>
        <div className="sm:col-span-3 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating..." : "Create deal"}
          </Button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      </form>
    </Surface>
  );
}
