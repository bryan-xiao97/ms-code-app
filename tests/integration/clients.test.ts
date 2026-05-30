import { describe, it, expect } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";

describe("service client", () => {
  it("can read auth.users via admin API", async () => {
    const svc = createServiceClient();
    const { error } = await svc.auth.admin.listUsers();
    expect(error).toBeNull();
  });
});
