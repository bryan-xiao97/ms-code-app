import { createClient } from "@/lib/supabase/server";
import { DealList } from "@/components/deal/DealList";

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
      <DealList deals={deals ?? []} />
    </div>
  );
}
