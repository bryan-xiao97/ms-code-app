import { test, expect } from "@playwright/test";
import { getMagicLink, clearInbucket } from "./helpers/inbucket";

test.beforeEach(async () => {
  await clearInbucket();
});

test("user can create a deal, change stage, add a milestone", async ({ page }) => {
  const email = `pm-${Date.now()}@test.local`;

  // Sign in
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  const link = await getMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/deals$/);

  // Create deal
  await page.getByLabel("Deal name").fill("Project E2E");
  await page.getByLabel("Target company").fill("AcmeCo");
  await page.getByLabel("Sector (optional)").fill("Tech");
  await page.getByRole("button", { name: /create deal/i }).click();

  // Land on workspace, see deal name
  await expect(page.getByRole("heading", { name: "Project E2E" })).toBeVisible();
  await expect(page.getByText("AcmeCo · Tech")).toBeVisible();

  // Change stage
  await page.getByLabel(/^stage/i).selectOption("buyer_gtm");
  // Wait for the optimistic save to commit before reloading (StageSelector shows "(saving…)" while pending)
  await expect(page.getByText(/saving/i)).toBeHidden();
  await expect(page.getByLabel(/^stage/i)).toBeEnabled();
  // Reload the page to confirm the change persisted
  await page.reload();
  await expect(page.getByLabel(/^stage/i)).toHaveValue("buyer_gtm");

  // Add milestone
  await page.getByPlaceholder("Milestone name").fill("Send NDA");
  const due = new Date();
  due.setDate(due.getDate() + 3);
  const dueStr = due.toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(dueStr);
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText("Send NDA")).toBeVisible();
  await expect(page.getByText(/due soon/i)).toBeVisible();
});
