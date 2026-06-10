import { randomUUID } from "node:crypto";

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string };

/** Build the deal-scoped storage key: '{dealId}/original/{uuid}.{ext}'. */
export function buildStoragePath(dealId: string, filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "bin";
  return `${dealId}/original/${randomUUID()}.${ext}`;
}
