"use client";

import { use, useState } from "react";
import { DocumentUpload } from "@/components/deal/DocumentUpload";
import { DocumentList } from "@/components/deal/DocumentList";
import { QAPanel } from "@/components/deal/QAPanel";

export default function QATab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2 rounded-md border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Ask the documents</h2>
        <QAPanel dealId={id} />
      </section>
      <aside className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Documents</h2>
        <div className="mb-4">
          <DocumentUpload dealId={id} onUploaded={() => setRefreshKey((k) => k + 1)} />
        </div>
        <DocumentList dealId={id} refreshKey={refreshKey} />
      </aside>
    </div>
  );
}
