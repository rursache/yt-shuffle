import { test, expect } from '@playwright/test';

async function serveVersion(page, version) {
    await page.route('**/js/app.js', async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replace('__APP_VERSION__', version);
        await route.fulfill({ response, body });
    });
}

test('shows dev in the logo tooltip when no version was injected', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo')).toHaveAttribute('title', 'dev');
});

test('shows a release tag as is in the logo tooltip', async ({ page }) => {
    await serveVersion(page, 'v1.2.3');
    await page.goto('/');
    await expect(page.locator('.logo')).toHaveAttribute('title', 'v1.2.3');
});

test('shows a commit hash with a # prefix in the logo tooltip', async ({ page }) => {
    await serveVersion(page, 'abc1234');
    await page.goto('/');
    await expect(page.locator('.logo')).toHaveAttribute('title', '#abc1234');
});
