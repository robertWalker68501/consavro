import { test, expect } from '@playwright/test';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

test.describe('authentication core workflow', () => {
  test.beforeAll(async () => { await resetTestAccount(); });
  test.afterAll(async () => { await resetTestAccount(); });

  test('approved user signs up, verifies email, signs in, and signs out', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill('Consavro E2E User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    // Form components can render empty role="alert" containers for validation.
    // Wait for a real outcome rather than treating an empty alert as a failure.
    await expect(async () => {
      const status = (await page.getByRole('status').allTextContents()).join(' ').trim();
      const errors = (await page.getByRole('alert').allTextContents())
        .map((message) => message.trim())
        .filter(Boolean);
      if (errors.length) throw new Error(`Sign-up failed: ${errors.join(' | ')}`);
      expect(status).toContain('Check your email');
    }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

    // Before verification, password login must not grant dashboard access.
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard(?:\?|$)/);

    const verificationUrl = await waitForVerificationUrl();
    await page.goto(verificationUrl);
    await expect.poll(async () => {
      // The verification callback may redirect before the UI updates.
      return isTestEmailVerified();
    }, { timeout: 20_000 }).toBe(true);

    await signIn(page);
    await expect(page.getByRole('heading', { name: /^Good to see you, Consavro E2E User$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });
});
