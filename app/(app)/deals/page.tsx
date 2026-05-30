import { createClient } from "@/lib/supabase/server";

export default async function DealsPage() {
  const supabase = await createClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, name, target_company, sector, stage")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
      </div>
      {deals && deals.length > 0 ? (
        <ul className="grid gap-3">
          {deals.map((d) => (
            <li
              key={d.id}
              className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700"
            >
              {d.name} — {d.target_company} ({d.stage})
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No deals yet.</p>
      )}
    </div>
  );
}
