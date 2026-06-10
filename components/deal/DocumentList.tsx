"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Doc = {
  id: string;
  filename: string;
  ingest_status: "pending" | "parsing" | "embedding" | "ready" | "error";
  ingest_error: string | null;
  storage_path: string;
  uploaded_at: string;
};

const STATUS_STYLES: Record<Doc["ingest_status"], string> = {
  pending: "bg-slate-100 text-slate-600",
  parsing: "bg-amber-50 text-amber-700",
  embedding: "bg-amber-50 text-amber-700",
  ready: "bg-emerald-50 text-emerald-700",
  error: "bg-rose-50 text-rose-700",
};

export function DocumentList({ dealId, refreshKey }: { dealId: string; refreshKey: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("documents")
      .select("id, filename, ingest_status, ingest_error, storage_path, uploaded_at")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false });
    setDocs((data ?? []) as Doc[]);
    setLoading(false);
  }, [dealId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const stillWorking = docs.some(
      (d) => d.ingest_status !== "ready" && d.ingest_status !== "error"
    );
    if (stillWorking) {
      timer.current = setTimeout(load, 3000);
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
    }
  }, [docs, load]);

  async function download(d: Doc) {
    const { data } = await supabase.storage
      .from("deal-documents")
      .createSignedUrl(d.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  if (loading) return <p className="text-sm text-slate-500">Loading documents…</p>;
  if (docs.length === 0)
    return <p className="text-sm text-slate-500">No documents uploaded yet.</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-2">
          <button
            type="button"
            onClick={() => download(d)}
            className="text-sm text-indigo-700 hover:underline"
          >
            {d.filename}
          </button>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[d.ingest_status]}`}
            {...(d.ingest_error !== null ? { title: d.ingest_error } : {})}
          >
            {d.ingest_status === "ready" ? "Ready" : d.ingest_status}
          </span>
        </li>
      ))}
    </ul>
  );
}
