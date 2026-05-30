"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/Select";
import { updateStage } from "@/app/(app)/deals/[id]/actions";

const STAGES = [
  { value: "preparation", label: "Preparation" },
  { value: "marketing_cim", label: "Marketing / CIM" },
  { value: "buyer_gtm", label: "Buyer GTM" },
  { value: "detailed_dd", label: "Detailed DD" },
  { value: "close", label: "Close" },
] as const;

export function StageSelector({ dealId, initialStage }: { dealId: string; initialStage: string }) {
  const [stage, setStage] = useState(initialStage);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(nextStage: string) {
    const previous = stage;
    setStage(nextStage); // optimistic
    setError(null);
    startTransition(async () => {
      const result = await updateStage(dealId, nextStage);
      if (!result.ok) {
        setStage(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <label htmlFor="stage" className="block text-xs font-medium text-slate-600 mb-1">
        Stage {pending && <span className="text-slate-400">(saving…)</span>}
      </label>
      <Select
        id="stage"
        value={stage}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
      >
        {STAGES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
