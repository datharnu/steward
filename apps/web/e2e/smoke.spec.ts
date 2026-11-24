import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/jailbreak", "/gate", "/try", "/vendor"];
const WIDTHS = [390, 768, 1280];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

for (const width of WIDTHS) {
  for (const path of PAGES) {
    test(`${path} at ${width}px has no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
    });
  }
}

test("the homepage lists the seven testnet steps", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main ol").last().locator(":scope > li")).toHaveCount(7);
  await expect(page.getByText("3DEB1D5B87", { exact: false }).first()).toBeVisible();
});

test("the gate page shows a live read or says it could not read", async ({ page }) => {
  await page.goto("/gate");
  await expect(page.getByText(/fUSD held/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Read again|Reading/ })).toBeVisible();
  await expect(page.getByText(/Couldn’t read the gate|^\d+\.\d{6}$/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Check this payment" })).toBeVisible();
  await expect(page.getByText("The recorded pay has not been checked.")).toBeVisible();
});

test("the receipt's ML-DSA signature checks in the browser", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/gate");
  await page.getByRole("button", { name: "Check the receipt" }).click();
  await expect(page.getByText("The hash matches and the ML-DSA signature checks.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Change one character" }).click();
  await expect(page.getByText("The ML-DSA signature does not check.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Check the real receipt" }).click();
  await expect(page.getByText("The hash matches and the ML-DSA signature checks.")).toBeVisible({ timeout: 20_000 });
  expect(errors.filter((text) => /Content Security Policy|EvalError/.test(text))).toEqual([]);
});

test("the desk refuses a different payee with the recorded hash", async ({ page }) => {
  await page.goto("/try");
  await page.getByRole("button", { name: "Try a different invoice" }).click();
  await page.getByRole("button", { name: "Someone else" }).click();
  const slip = page.getByRole("complementary");
  await expect(slip.getByText("REFUSED_PAYEE_MISMATCH", { exact: true })).toBeVisible();
  await expect(slip.getByText("WrongPayee")).toBeVisible();
  await expect(slip.getByText("43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03")).toBeVisible();
});

test("a vendor can sign an invoice in the tab, and a bad address is refused", async ({ page }) => {
  await page.goto("/vendor");
  await page.getByRole("button", { name: "Sign an invoice" }).click();
  await expect(page.getByText(/Signed, and the signature checks/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Download invoice.json" })).toBeVisible();

  await page.getByLabel("Payout address").fill("not-an-address");
  await page.getByRole("button", { name: "Sign another" }).click();
  await expect(page.getByText("The payout needs a 20-byte address.")).toBeVisible();
});

test("old paths redirect to the new pages", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/try$/);
  await page.goto("/live");
  await expect(page).toHaveURL(/\/gate$/);
});
