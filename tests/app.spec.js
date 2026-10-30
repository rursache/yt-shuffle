import { test, expect } from '@playwright/test';
import { mockYouTubeApi, player, BROKEN } from './support/mock-youtube-api.js';

const PLAYING = 1;

async function activeIndex(page) {
    return Number(await page.locator('.playlist-item.active').getAttribute('data-index'));
}

async function loadFromInput(page, value) {
    await page.locator('#playlist-input').fill(value);
    await page.locator('#shuffle-btn').click();
}

test.describe('playlist loading', () => {
    test('fetches every page and starts playback muted from a shared link', async ({ page }) => {
        const requests = await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');

        await expect(page.locator('#playlist-count')).toHaveText('9 videos');
        await expect(page.locator('.playlist-item')).toHaveCount(9);
        expect(requests).toEqual([
            { playlistId: 'PLmultipage0001', pageToken: null },
            { playlistId: 'PLmultipage0001', pageToken: 'PAGE1' },
        ]);
        await expect(page.locator('#input-section')).toBeHidden();
        await expect.poll(() => player(page).state()).toBe(PLAYING);
        expect(await player(page).muted()).toBe(true);
    });

    test('uses singular wording for a one video playlist', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLsinglevideo01');
        await expect(page.locator('#playlist-count')).toHaveText('1 video');
    });

    test('accepts links without a scheme', async ({ page }) => {
        const requests = await mockYouTubeApi(page);
        await page.goto('/');
        await loadFromInput(page, 'www.youtube.com/watch?v=abc&list=PLsinglevideo01&index=2');
        await expect(page.locator('#playlist-count')).toHaveText('1 video');
        expect(requests[0].playlistId).toBe('PLsinglevideo01');
        await expect(page).toHaveURL(/\?pid=PLsinglevideo01$/);
    });

    test('rejects input without a playlist before calling the API', async ({ page }) => {
        const requests = await mockYouTubeApi(page);
        await page.goto('/');
        await loadFromInput(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        await expect(page.locator('#error')).toHaveText('Please enter a valid YouTube playlist URL or ID.');
        expect(requests).toHaveLength(0);
    });

    test('shows the input again when a shared link is invalid', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=nope');
        await expect(page.locator('#error')).toBeVisible();
        await expect(page.locator('#input-section')).toBeVisible();
        await expect(page.locator('#change-playlist-btn')).toBeHidden();
    });

    test('skips deleted, private and malformed items', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLplaceholders1');
        await expect(page.locator('#error')).toHaveText('No playable videos found in this playlist.');
        await expect(page.locator('#input-section')).toBeVisible();
    });

    for (const [playlistId, message] of [
        ['PLnotfound00001', 'Playlist not found. Make sure it exists and is public or unlisted.'],
        ['PLprivate000001', 'This playlist is private. Only public or unlisted playlists can be shuffled.'],
        ['PLquota00000001', 'The daily YouTube API quota has been used up. Please try again tomorrow.'],
    ]) {
        test(`maps the ${playlistId} API error to a readable message`, async ({ page }) => {
            await mockYouTubeApi(page);
            await page.goto(`/?pid=${playlistId}`);
            await expect(page.locator('#error')).toHaveText(message);
        });
    }

    test('explains when YouTube cannot be reached', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLoffline000001');
        await expect(page.locator('#error')).toHaveText('Could not reach YouTube. Check your connection and try again.');
    });

    test('lets the newest load win when loads overlap', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/');
        await page.locator('#playlist-input').fill('PLslowplaylist1');
        await page.locator('#playlist-input').press('Enter');
        await page.locator('#playlist-input').fill('PLsinglevideo01');
        await page.locator('#playlist-input').press('Enter');

        await expect(page.locator('#playlist-count')).toHaveText('1 video');
        await page.waitForTimeout(3500);
        await expect(page.locator('#playlist-count')).toHaveText('1 video');
        await expect(page).toHaveURL(/\?pid=PLsinglevideo01$/);
    });

    test('restores the previous playlist when a reload fails', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);

        await page.locator('#change-playlist-btn').click();
        await loadFromInput(page, 'PLnotfound00001');

        await expect(page.locator('#error')).toBeVisible();
        await expect(page.locator('#content')).toBeVisible();
        await expect(page.locator('#playlist-count')).toHaveText('9 videos');
        await expect(page).toHaveURL(/\?pid=PLmultipage0001$/);
        expect(await player(page).state()).not.toBe(PLAYING);
    });
});

test.describe('playback', () => {
    test('moves forward and back through the shuffled list', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);

        const start = await activeIndex(page);
        await page.locator('#prev-btn').click();
        await expect.poll(() => player(page).state()).toBe(PLAYING);
        expect(await activeIndex(page)).not.toBe(start);

        await page.locator('#next-btn').click();
        await expect.poll(() => player(page).state()).toBe(PLAYING);
        expect(await activeIndex(page)).toBe(start);
    });

    test('keeps the current video first after a reshuffle', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);

        const title = await page.locator('#now-playing-title').textContent();
        await page.locator('#reshuffle-btn').click();
        await expect(page.locator('#now-playing-title')).toHaveText(title);
        expect(await activeIndex(page)).toBe(0);
    });

    test('skips a video that cannot be embedded', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);

        const broken = page.locator('.playlist-item', { hasText: 'Broken video' });
        const brokenIndex = Number(await broken.getAttribute('data-index'));
        await broken.click();

        await expect.poll(() => activeIndex(page)).not.toBe(brokenIndex);
        expect(await player(page).videoId()).not.toBe(BROKEN);
    });

    test('stops and explains when no video can be embedded', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLallbroken0001');
        await expect(page.locator('#error')).toHaveText('None of the videos in this playlist can be played in an embedded player.');

        await page.locator('#shuffle-again-btn').click();
        await expect(page.locator('#error')).toBeHidden();
    });

    test('plays a row with the keyboard', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);

        const target = page.locator('.playlist-item:not(.active)', { hasNotText: 'Broken video' }).first();
        const index = Number(await target.getAttribute('data-index'));
        await target.focus();
        await page.keyboard.press('Enter');

        expect(await activeIndex(page)).toBe(index);
        await expect(page.locator('[aria-current="true"]')).toHaveAttribute('data-index', String(index));
    });

    test('filters the list without losing the active row', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await page.locator('#filter-input').fill('Video 2');
        await expect(page.locator('.playlist-item')).toHaveCount(1);
        await page.locator('#filter-input').fill('');
        await expect(page.locator('.playlist-item')).toHaveCount(9);
        await expect(page.locator('.playlist-item.active')).toHaveCount(1);
    });

    test('unmutes on the first real click on the page', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);
        expect(await player(page).muted()).toBe(true);

        await page.locator('#playlist-count').click();
        await expect.poll(() => player(page).muted()).toBe(false);
        expect(await player(page).state()).toBe(PLAYING);
    });

    test('plays with sound when started from the input', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/');
        await loadFromInput(page, 'PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);
        expect(await player(page).muted()).toBe(false);
    });
});

test.describe('navigation', () => {
    test('follows back and forward between playlists and home', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/');
        await loadFromInput(page, 'PLmultipage0001');
        await expect(page.locator('#playlist-count')).toHaveText('9 videos');

        await page.locator('#change-playlist-btn').click();
        await loadFromInput(page, 'PLsinglevideo01');
        await expect(page.locator('#playlist-count')).toHaveText('1 video');

        await page.goBack();
        await expect(page).toHaveURL(/\?pid=PLmultipage0001$/);
        await expect(page.locator('#playlist-count')).toHaveText('9 videos');

        await page.goBack();
        await expect(page.locator('#input-section')).toBeVisible();
        await expect(page.locator('#content')).toBeHidden();
        await expect(page.locator('#player-column iframe')).toHaveCount(0);

        await page.goForward();
        await expect(page.locator('#playlist-count')).toHaveText('9 videos');
    });

    test('does not add a history entry for the playlist already in the URL', async ({ page }) => {
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLsinglevideo01');
        await expect(page.locator('#playlist-count')).toHaveText('1 video');
        expect(await page.evaluate(() => history.length)).toBe(2);
    });
});

test.describe('layout', () => {
    test('scrolls only the playlist on narrow screens', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect.poll(() => player(page).state()).toBe(PLAYING);

        for (let i = 0; i < 4; i++) {
            await page.locator('#next-btn').click();
            await page.waitForTimeout(400);
        }
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect(await page.locator('#playlist-list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    });

    test('keeps the controls reachable on short desktop windows', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 600 });
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect(page.locator('#content')).toBeVisible();

        await page.locator('.controls').scrollIntoViewIfNeeded();
        const box = await page.locator('.controls').boundingBox();
        expect(Math.floor(box.y + box.height)).toBeLessThanOrEqual(600);
    });

    test('matches the playlist height to the player column', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLmultipage0001');
        await expect(page.locator('#content')).toBeVisible();

        const heights = () => page.evaluate(() => ({
            player: document.getElementById('player-column').offsetHeight,
            playlist: document.getElementById('playlist-column').style.maxHeight,
        }));
        await expect.poll(async () => { const h = await heights(); return h.playlist === `${h.player}px`; }).toBe(true);

        await page.evaluate(() => { document.getElementById('now-playing-title').textContent = 'A long title '.repeat(40); });
        await expect.poll(async () => { const h = await heights(); return h.playlist === `${h.player}px`; }).toBe(true);
    });
});

test.describe('theme', () => {
    test('persists the chosen theme across reloads', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto('/');
        await page.locator('#theme-toggle').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });

    test('still works when storage is blocked', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
        });
        await mockYouTubeApi(page);
        await page.goto('/?pid=PLsinglevideo01');
        await expect(page.locator('#playlist-count')).toHaveText('1 video');
        await page.locator('#theme-toggle').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
    });
});
