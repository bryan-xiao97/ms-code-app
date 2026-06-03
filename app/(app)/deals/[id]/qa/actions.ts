"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { buildStoragePath, type UploadDocumentResult } from "./storage-path";

const BUCKET = "deal-documents";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED = new Set(["application/pdf", "text/plain", "text/markdown"]);

export async function uploadDocument(
  dealId: string,
  formData: FormData
): Promise<UploadDocumentResult> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return { ok: false, error: "Not authenticated." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File exceeds the 25 MB limit." };
  }
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED.has(mimeType)) {
    return { ok: false, error: "Only PDF, text, or markdown files are supported." };
  }

  const storagePath = buildStoragePath(dealId, file.name);

  // RLS on storage.objects blocks uploads to deals the caller isn't a member of.
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: mimeType, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { data: doc, error: insErr } = await supabase
    .from("documents")
    .insert({
      deal_id: dealId,
      storage_path: storagePath,
      filename: file.name,
      mime_type: mimeType,
      uploaded_by: userData.user.id,
    })
    .select("id")
    .single();
  if (insErr || !doc) {
    // Roll back the orphaned object.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: insErr?.message ?? "Failed to record document." };
  }

  await inngest.send({
    name: "document.uploaded",
    data: { documentId: doc.id, dealId },
  });

  revalidatePath(`/deals/${dealId}/qa`);
  return { ok: true, documentId: doc.id };
}
