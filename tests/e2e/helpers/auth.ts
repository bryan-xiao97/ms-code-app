import type { Page } from "@playwright/test";
import { getConfirmationLink } from "./inbucket";

/**
 * Registers a brand-new account, confirms it via the Mailpit link, and lands the
 * page on /deals. Used by e2e specs that need an authenticated, empty workspace.
 */
export async function registerAndSignIn(
  page: Page,
  email: string,
  password = "e2e-password-123"
): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  const link = await getConfirmationLink(email);
  await page.goto(link);
  await page.waitForURL(/\/deals$/, { timeout: 15_000 });
}
