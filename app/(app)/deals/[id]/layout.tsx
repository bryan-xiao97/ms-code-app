import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { DealHeader } from "@/components/deal/DealHeader";
import { DealTabs } from "@/components/deal/DealTabs";

export default async function DealLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, name, target_company, sector")
    .eq("id", id)
    .maybeSingle();

  if (!deal) notFound();

  return (
    <>
      <DealHeader name={deal.name} targetCompany={deal.target_company} sector={deal.sector} />
      <DealTabs dealId={deal.id} />
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </>
  );
}
