import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { docIngest } from "@/inngest/doc-ingest";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [docIngest],
});
