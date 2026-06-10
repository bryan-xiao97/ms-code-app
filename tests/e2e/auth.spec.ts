import { test, expect } from "@playwright/test";
import { getConfirmationLink, clearInbucket } from "./helpers/inbucket";

test.beforeEach(async () => {
  await clearInbucket();
});

test("new user can sign up, confirm email, and reach /deals", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`;
  const password = "e2e-password-123";

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  const link = await getConfirmationLink(email);
  await page.goto(link);

  await expect(page).toHaveURL(/\/deals$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(page.getByText("No deals yet.")).toBeVisible();
});

test("seeded demo user can sign in with a password", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@local.test");
  await page.getByLabel("Password", { exact: true }).fill("demo-password-12345");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page).toHaveURL(/\/deals$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
});

test("wrong password shows a generic error and stays on /sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@local.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});
