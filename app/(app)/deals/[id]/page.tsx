import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StageSelector } from "@/components/deal/StageSelector";
import { MilestoneList } from "@/components/deal/MilestoneList";
import { ActivityFeed } from "@/components/deal/ActivityFeed";

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
        <MilestoneList dealId={deal.id} />
      </section>
      <aside className="space-y-6">
        <div className="rounded-md border border-slate-200 bg-white p-5">
          <StageSelector dealId={deal.id} initialStage={deal.stage} />
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Activity</h2>
          <ActivityFeed dealId={deal.id} />
        </div>
      </aside>
    </div>
  );
}
