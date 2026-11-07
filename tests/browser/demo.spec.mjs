import { test, expect } from '@playwright/test';

test('the local demo keeps its ranking and history when revisited later', async ({ page }) => {
  await page.clock.setFixedTime(new Date(Date.now() + 40 * 86_400_000));
  await page.goto('/');
  await expect(page.getByText('Northvale Regional', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Demo snapshot', { exact: true })).toBeVisible();
  await expect(page.getByText(/Updates delayed/)).toHaveCount(0);
  await page.getByRole('button', { name: /Airborne history/ }).first().click();
  await expect(page.getByRole('img', { name: /All aircraft: [1-9]/ })).toBeVisible();
  await expect(page.getByText('History updates are delayed.')).toHaveCount(0);
});
