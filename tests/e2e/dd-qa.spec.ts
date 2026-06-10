import path from "node:path";
import { test, expect } from "@playwright/test";
import { getMagicLink, clearInbucket } from "./helpers/inbucket";

// Prerequisites to actually PASS (not skip): local Supabase running, the Next dev
// server running, the Inngest dev server running (`pnpm inngest:dev`), and a real
// GEMINI_API_KEY in .env.local. Without a key the test self-skips.
test.skip(!process.env.GEMINI_API_KEY, "GEMINI_API_KEY required for DD Q&A E2E");

test.beforeEach(async () => {
  await clearInbucket();
});

test("upload a document, ingest it, and get a cited answer", async ({ page }) => {
  const email = `qa-${Date.now()}@test.local`;

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  const link = await getMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/deals$/);

  // Create a deal
  await page.getByLabel("Deal name").fill("Project QA");
  await page.getByLabel("Target company").fill("Acme Corp");
  await page.getByRole("button", { name: /create deal/i }).click();
  await expect(page.getByRole("heading", { name: "Project QA" })).toBeVisible();

  // Go to DD Q&A tab
  await page.getByRole("link", { name: "DD Q&A" }).click();

  // Upload the fixture
  await page.setInputFiles(
    'input[type="file"]',
    path.join(__dirname, "fixtures", "sample.txt")
  );
  await page.getByRole("button", { name: /upload/i }).click();

  // Wait for ingestion to finish (badge → Ready); generous timeout for embed call.
  await expect(page.getByText("Ready")).toBeVisible({ timeout: 60_000 });

  // Ask a question
  await page.getByPlaceholder(/ask a question/i).fill("What was Acme Corp revenue?");
  await page.getByRole("button", { name: /^ask$/i }).click();

  // Expect an answer mentioning the figure and at least one citation chip
  await expect(page.getByText(/50 million|\$50/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("text=/^doc /")).toBeVisible();
});
