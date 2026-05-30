import { createClient } from "@/lib/supabase/server";

type Row = {
  kind: string;
  id: string;
  deal_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

const KIND_LABEL: Record<string, string> = {
  placeholder: "—",
  qa: "Q&A",
  buyer_comm: "Buyer touch",
  buyer_generated: "Buyer added",
};

function describe(row: Row): string {
  switch (row.kind) {
    case "qa":
      return `Question: ${String(row.payload.question ?? "")}`;
    case "buyer_comm":
      return String(row.payload.summary ?? "");
    case "buyer_generated":
      return `Added ${String(row.payload.firm_name ?? "buyer")}`;
    default:
      return "";
  }
}

export async function ActivityFeed({ dealId }: { dealId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_activity")
    .select("kind, id, deal_id, occurred_at, payload")
    .eq("deal_id", dealId)
    .order("occurred_at", { ascending: false })
    .limit(10);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Activity will appear here as buyer touches and Q&amp;A history populate.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id} className="py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block text-xs uppercase tracking-wide text-slate-400">
              {KIND_LABEL[r.kind] ?? r.kind}
            </span>
            <span className="text-xs text-slate-400">
              {new Date(r.occurred_at).toLocaleString()}
            </span>
          </div>
          <p className="text-slate-700">{describe(r)}</p>
        </li>
      ))}
    </ul>
  );
}
