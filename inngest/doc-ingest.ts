/**
 * pdf-parse v2 API notes (v2 is a ground-up rewrite vs v1):
 *   - Export: `import { PDFParse } from "pdf-parse"` — class-based, NOT the v1 default function.
 *   - Constructor: `new PDFParse({ data: Buffer | ArrayBuffer | Uint8Array })`.
 *   - Text extraction: instance.getText() → Promise<TextResult>.
 *   - TextResult fields: `.text` (string) and `.total` (number = total pages).
 *   - The @types/pdf-parse package ships v1 types (default-export function signature)
 *     and is incompatible with v2. We do NOT import @types/pdf-parse; instead we rely
 *     on pdf-parse v2's own bundled .d.cts declarations.
 */
import { PDFParse } from "pdf-parse";
import { inngest, documentUploaded } from "./client";
import { createServiceClient } from "@/lib/supabase/service";
import { getLLM } from "@/lib/llm";
import { ingestDocument, type ParsedDoc } from "@/lib/rag/ingest";

async function parsePdf(bytes: ArrayBuffer, mimeType: string): Promise<ParsedDoc> {
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    return { text: result.text, pageCount: result.total };
  }
  // Plain text fallback (txt/markdown).
  return { text: new TextDecoder().decode(bytes), pageCount: null };
}

export const docIngest = inngest.createFunction(
  // v4: createFunction takes 2 args (options, handler). Trigger goes inside options.triggers.
  {
    id: "doc-ingest",
    retries: 3,
    triggers: [{ event: documentUploaded }],
  },
  async ({ event, step }) => {
    await step.run("ingest", async () => {
      await ingestDocument({
        documentId: event.data.documentId,
        deps: {
          supabase: createServiceClient(),
          llm: getLLM(),
          parse: parsePdf,
        },
      });
      return { documentId: event.data.documentId };
    });
    return { ok: true };
  },
);
