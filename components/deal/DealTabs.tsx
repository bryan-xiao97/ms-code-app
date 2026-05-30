"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { clsx } from "clsx";

const TABS = [
  { segment: null, label: "Overview", href: (id: string) => `/deals/${id}` },
  { segment: "buyers", label: "Buyers", href: (id: string) => `/deals/${id}/buyers` },
  { segment: "qa", label: "DD Q&A", href: (id: string) => `/deals/${id}/qa` },
] as const;

export function DealTabs({ dealId }: { dealId: string }) {
  const active = useSelectedLayoutSegment();
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const isActive = active === t.segment;
            return (
              <li key={t.label}>
                <Link
                  href={t.href(dealId)}
                  className={clsx(
                    "inline-block px-4 py-3 text-sm font-medium border-b-2 -mb-px transition",
                    isActive
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-slate-600 hover:text-slate-900"
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
