"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Citation = {
  document_id: string;
  page: number | null;
  chunk_id: string;
  snippet: string;
  score: number;
};

type Answer = { answer: string; citations: Citation[] };

export function QAPanel({ dealId }: { dealId: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (question.trim().length < 3) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await fetch(`/api/deals/${dealId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }
      setResult(json as Answer);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={ask} className="flex gap-2">
        <Input
          placeholder="Ask a question about the deal documents…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={2000}
        />
        <Button type="submit" disabled={pending || question.trim().length < 3}>
          {pending ? "Thinking…" : "Ask"}
        </Button>
      </form>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {result && (
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="whitespace-pre-wrap text-sm text-slate-800">{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.citations.map((c) => (
                <span
                  key={c.chunk_id}
                  title={c.snippet}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                >
                  doc {c.document_id.slice(0, 8)}
                  {c.page != null ? ` · p.${c.page}` : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
