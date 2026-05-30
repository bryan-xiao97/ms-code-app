import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StageSelector } from "@/components/deal/StageSelector";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, stage")
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2 rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Milestones</h2>
        <p className="text-sm text-slate-500">Milestones list will go here.</p>
      </section>
      <aside className="rounded-md border border-slate-200 bg-white p-5">
        <StageSelector dealId={deal.id} initialStage={deal.stage} />
      </aside>
    </div>
  );
}
