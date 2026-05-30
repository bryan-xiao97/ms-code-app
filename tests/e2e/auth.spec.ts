import { test, expect } from "@playwright/test";
import { getMagicLink, clearInbucket } from "./helpers/inbucket";

test.beforeEach(async () => {
  await clearInbucket();
});

test("user can sign in via magic link and reach /deals", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`;

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  const link = await getMagicLink(email);
  await page.goto(link);

  await expect(page).toHaveURL(/\/deals$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(page.getByText("No deals yet.")).toBeVisible();
});
