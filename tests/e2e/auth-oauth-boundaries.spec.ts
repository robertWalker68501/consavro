import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const providers = ['google', 'github'] as const;
type Provider = (typeof providers)[number];

function oauthStart(request: APIRequestContext, provider: Provider) {
  return request.post('/api/auth/sign-in/social', {
    data: {
      provider,
      callbackURL: '/dashboard',
      errorCallbackURL: '/sign-in',
      disableRedirect: true,
    },
    maxRedirects: 0,
  });
}

async function expectAnonymous(page: Page) {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
}

test.describe('Google/GitHub OAuth security boundaries', () => {
  for (const provider of providers) {
    test(`${provider} button initiates the expected Better Auth provider`, async ({ page }) => {
      await page.goto('/sign-in');
      const call = page.waitForRequest(req =>
        req.url().includes('/api/auth/sign-in/social') && req.method() === 'POST',
      );
      // Prevent navigation to a third-party identity provider. This test checks only our app's boundary.
      await page.route('https://accounts.google.com/**', route => route.abort());
      await page.route('https://github.com/login/oauth/**', route => route.abort());
      await page.getByRole('button', { name: provider === 'google' ? 'Google' : 'GitHub' }).click();
      const outgoing = await call;
      expect(JSON.parse(outgoing.postData() ?? '{}')).toMatchObject({
        provider,
        callbackURL: '/dashboard',
        errorCallbackURL: '/sign-in',
      });
    });

    test(`${provider} social endpoint handles configured or disabled provider safely`, async ({ request }) => {
      const response = await oauthStart(request, provider);
      expect(response.status()).toBeLessThan(500);
      const body = await response.text();
      // With OAuth credentials configured, Better Auth returns an authorization URL.
      // Without them, it must reject the provider; neither case should expose secrets.
      if (response.ok()) {
        const payload = JSON.parse(body) as { url?: string };
        expect(payload.url).toBeTruthy();
        const destination = new URL(payload.url!);
        expect(destination.protocol).toBe('https:');
        expect(destination.hostname).toBe(provider === 'google' ? 'accounts.google.com' : 'github.com');
        expect(destination.searchParams.get('state')).toBeTruthy();
        expect(destination.searchParams.get('client_secret')).toBeNull();
      } else {
        expect([400, 401, 403, 404, 422]).toContain(response.status());
      }
      expect(body).not.toMatch(/client_secret|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_SECRET|DATABASE_URL/i);
    });

    test(`${provider} callback with forged state cannot create a session`, async ({ page }) => {
      const response = await page.goto(`/api/auth/callback/${provider}?code=forged-code&state=forged-state`);
      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(500);
      await expectAnonymous(page);
    });

    test(`${provider} callback without state cannot create a session`, async ({ page }) => {
      const response = await page.goto(`/api/auth/callback/${provider}?code=forged-code`);
      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(500);
      await expectAnonymous(page);
    });
  }

  test('cancelled OAuth flow does not grant access', async ({ page }) => {
    await page.goto('/sign-in?error=access_denied');
    await expect(page.getByRole('heading', { name: /Sign in to Consavro/i })).toBeVisible();
    await expectAnonymous(page);
  });

  test('malicious callback URL cannot establish an authenticated session', async ({ request, page }) => {
    const response = await request.post('/api/auth/sign-in/social', {
      data: { provider: 'not-a-provider', callbackURL: 'https://attacker.example/collect', disableRedirect: true },
      maxRedirects: 0,
    });
    expect(response.status()).toBeLessThan(500);
    expect(response.ok()).toBe(false);
    await expectAnonymous(page);
  });
});
