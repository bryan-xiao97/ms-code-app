import Link from "next/link";

type Deal = {
  id: string;
  name: string;
  target_company: string;
  sector: string | null;
  stage: string;
};

const STAGE_LABEL: Record<string, string> = {
  preparation: "Preparation",
  marketing_cim: "Marketing / CIM",
  buyer_gtm: "Buyer GTM",
  detailed_dd: "Detailed DD",
  close: "Close",
};

export function DealList({ deals }: { deals: Deal[] }) {
  if (deals.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No deals yet. Create one to get started.
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {deals.map((d) => (
        <li key={d.id}>
          <Link
            href={`/deals/${d.id}`}
            className="block rounded-md border border-slate-200 bg-white p-4 hover:border-indigo-300 transition"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-900">{d.name}</p>
                <p className="text-xs text-slate-500">
                  {d.target_company}
                  {d.sector ? ` · ${d.sector}` : ""}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {STAGE_LABEL[d.stage] ?? d.stage}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
