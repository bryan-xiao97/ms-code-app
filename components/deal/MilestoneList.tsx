"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClient } from "@/lib/supabase/client";

type Milestone = {
  id: string;
  deal_id: string;
  name: string;
  due_date: string;
  status: "pending" | "done" | "skipped";
};

const DUE_SOON_DAYS = 5;

function dueSoon(dueDate: string): boolean {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= DUE_SOON_DAYS;
}

export function MilestoneList({ dealId }: { dealId: string }) {
  const supabase = createClient();
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function reload() {
    const { data, error } = await supabase
      .from("milestones")
      .select("id, deal_id, name, due_date, status")
      .eq("deal_id", dealId)
      .order("due_date", { ascending: true });
    if (error) setError(error.message);
    setItems((data ?? []) as Milestone[]);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !due) return;
    setError(null);
    startTransition(async () => {
      const { error } = await supabase
        .from("milestones")
        .insert({ deal_id: dealId, name, due_date: due });
      if (error) setError(error.message);
      else {
        setName("");
        setDue("");
        await reload();
      }
    });
  }

  function toggleStatus(m: Milestone) {
    startTransition(async () => {
      const next = m.status === "done" ? "pending" : "done";
      const { error } = await supabase
        .from("milestones")
        .update({ status: next })
        .eq("id", m.id);
      if (error) setError(error.message);
      else await reload();
    });
  }

  function remove(m: Milestone) {
    startTransition(async () => {
      const { error } = await supabase.from("milestones").delete().eq("id", m.id);
      if (error) setError(error.message);
      else await reload();
    });
  }

  return (
    <div>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_180px_auto] mb-4">
        <Input
          placeholder="Milestone name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Button type="submit" disabled={pending || !name || !due}>
          Add
        </Button>
      </form>
      {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No milestones yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={m.status === "done"}
                  onChange={() => toggleStatus(m)}
                  disabled={pending}
                />
                <span className={m.status === "done" ? "line-through text-slate-400" : ""}>
                  {m.name}
                </span>
                <span className="text-xs text-slate-500">{m.due_date}</span>
                {m.status === "pending" && dueSoon(m.due_date) && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                    Due soon
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={() => remove(m)}
                disabled={pending}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
