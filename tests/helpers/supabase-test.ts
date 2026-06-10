import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!ANON || !SERVICE) {
  throw new Error(
    "Supabase env vars missing. Run with `dotenv -e .env.local -- pnpm test` " +
      "or export them in your shell."
  );
}

export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

/** Create a user via the service client and return a client signed in as them. */
export async function createTestUser(email: string): Promise<{
  userId: string;
  client: SupabaseClient;
}> {
  const svc = serviceClient();
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password: "test-password-12345",
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error("user not created");

  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: "test-password-12345",
  });
  if (signInErr) throw signInErr;

  return { userId: created.user.id, client };
}

/** Wipe all rows from public tables; safe because we run against local DB only. */
export async function resetDb(): Promise<void> {
  const svc = serviceClient();
  const tables = [
    "qa_log",
    "document_chunks",
    "documents",
    "milestones",
    "deal_members",
    "deals",
  ] as const;
  const keyCol: Record<(typeof tables)[number], string> = {
    qa_log: "id",
    document_chunks: "id",
    documents: "id",
    milestones: "id",
    deal_members: "deal_id",
    deals: "id",
  };
  for (const t of tables) {
    const { error } = await svc
      .from(t)
      .delete()
      .neq(keyCol[t], "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(`resetDb: ${t} delete failed: ${error.message}`);
  }
  // Clear storage objects so signed-URL/download tests start clean.
  const { data: objs } = await svc.storage.from("deal-documents").list("", {
    limit: 1000,
  });
  if (objs && objs.length > 0) {
    // Top-level entries are deal_id folders; remove recursively by listing each.
    for (const top of objs) {
      const { data: inner } = await svc.storage
        .from("deal-documents")
        .list(top.name, { limit: 1000 });
      const paths = (inner ?? []).map((f) => `${top.name}/${f.name}`);
      if (paths.length > 0) await svc.storage.from("deal-documents").remove(paths);
    }
  }
  // Clear auth users
  const { data: users, error: listErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw new Error(`resetDb: listUsers failed: ${listErr.message}`);
  for (const u of users?.users ?? []) {
    const { error } = await svc.auth.admin.deleteUser(u.id);
    if (error) throw new Error(`resetDb: deleteUser failed: ${error.message}`);
  }
}
