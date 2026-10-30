export const PLAYABLE = ['M7lc1UVf-VE', 'dQw4w9WgXcQ', 'jNQXAC9IVRw', '9bZkp7q19f0', 'aqz-KE-bpKQ', 'ScMzIvxBSi4', 'YE7VzlLtp-4', 'LXb3EKWsInQ'];
export const BROKEN = 'ZZZZZZZZZZZ';

function item(videoId, n, title = `Video ${n}`) {
    return {
        snippet: {
            title,
            videoOwnerChannelTitle: `Channel ${n}`,
            videoOwnerChannelId: `UC${n}`,
            resourceId: { videoId },
            thumbnails: { medium: { url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` } },
        },
        contentDetails: { videoPublishedAt: `2020-0${(n % 9) + 1}-15T00:00:00Z` },
    };
}

function apiError(code, reason, message) {
    return { status: code, body: { error: { code, message, errors: [{ reason }] } } };
}

export const PLAYLISTS = {
    PLmultipage0001: {
        pages: [
            [...PLAYABLE.slice(0, 4).map((id, i) => item(id, i + 1)), item(BROKEN, 99, 'Broken video')],
            PLAYABLE.slice(4).map((id, i) => item(id, i + 5)),
        ],
    },
    PLsinglevideo01: { pages: [[item(PLAYABLE[0], 1)]] },
    PLslowplaylist1: { delay: 3000, pages: [[item(PLAYABLE[1], 1), item(PLAYABLE[2], 2)]] },
    PLallbroken0001: { pages: [[item('AAAAAAAAAAA', 1), item('BBBBBBBBBBB', 2)]] },
    PLplaceholders1: {
        pages: [[
            { snippet: { title: 'Deleted video', resourceId: { videoId: 'deletedvid1' } } },
            { snippet: { title: 'Private video', resourceId: { videoId: 'privatevid1' } } },
            { snippet: { title: 'Missing id' } },
        ]],
    },
    PLnotfound00001: { error: apiError(404, 'playlistNotFound', "The playlist identified with the request's <code>playlistId</code> parameter cannot be found.") },
    PLprivate000001: { error: apiError(403, 'playlistItemsNotAccessible', 'The request is not properly authorized.') },
    PLquota00000001: { error: apiError(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.') },
};

export async function mockWorker(page) {
    const requests = [];
    await page.route((url) => url.hostname.endsWith('workers.dev'), async (route) => {
        const url = new URL(route.request().url());
        const playlistId = url.searchParams.get('playlistId');
        const pageToken = url.searchParams.get('pageToken');
        requests.push({ playlistId, pageToken });

        const playlist = PLAYLISTS[playlistId];
        if (playlist?.delay) await new Promise((r) => setTimeout(r, playlist.delay));

        let status = 200;
        let body;
        if (!playlist) {
            ({ status, body } = apiError(404, 'playlistNotFound', 'Not found'));
        } else if (playlist.error) {
            ({ status, body } = playlist.error);
        } else {
            const index = pageToken ? Number(pageToken.replace('PAGE', '')) : 0;
            body = { items: playlist.pages[index] };
            if (index + 1 < playlist.pages.length) body.nextPageToken = `PAGE${index + 1}`;
        }

        await route.fulfill({
            status,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(body),
        }).catch(() => {});
    });
    return requests;
}

export function player(page) {
    return {
        state: () => page.evaluate(() => window.YT?.get?.('player')?.getPlayerState?.() ?? null),
        muted: () => page.evaluate(() => window.YT?.get?.('player')?.isMuted?.() ?? null),
        videoId: () => page.evaluate(() => window.YT?.get?.('player')?.getVideoData?.().video_id ?? null),
    };
}
