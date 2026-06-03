"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { uploadDocument } from "@/app/(app)/deals/[id]/qa/actions";

export function DocumentUpload({
  dealId,
  onUploaded,
}: {
  dealId: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      const res = await uploadDocument(dealId, data);
      if (!res.ok) {
        setError(res.error);
      } else {
        form.reset();
        if (inputRef.current) inputRef.current.value = "";
        onUploaded();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept=".pdf,.txt,.md"
        className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}
