import { test, expect } from "@playwright/test";

test("home redirects to /deals", async ({ page }) => {
  const response = await page.goto("/");
  // /deals will eventually require auth; for now we just confirm the redirect chain
  expect(response).not.toBeNull();
  await expect(page).toHaveURL(/\/(deals|sign-in)/);
});
