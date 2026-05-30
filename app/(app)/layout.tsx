import Link from "next/link";
import { type ReactNode } from "react";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <Link href="/deals" className="font-semibold text-slate-900">
            Sell-Side M&amp;A
          </Link>
          <form action="/sign-out" method="post" className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{user.email}</span>
            <button
              type="submit"
              className="text-xs text-indigo-600 hover:text-indigo-500"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
